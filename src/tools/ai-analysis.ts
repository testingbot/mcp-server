import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError, sanitizeSessionId, sleep } from "../lib/utils.js";
import logger from "../lib/logger.js";

// AI Insights (AI test failure analysis) via GET/POST /v1/tests/:id/ai_analysis.
// The API applies the account's consent gate: until the account owner turns on
// AI Analysis in Account Settings it answers 403 with code
// "ai_analysis_not_enabled", and nothing is sent to the AI provider.

export interface AiAnalysis {
  test_id?: number;
  session_id?: string;
  status: "none" | "pending" | "running" | "complete" | "failed";
  error?: string | null;
  category?: string | null;
  owner_class?: string | null;
  confidence?: number | null;
  confidence_band?: string | null;
  sections?: Record<string, string>;
  stale?: boolean;
  model?: string | null;
  completed_at?: string | null;
  test_url?: string;
}

const SECTION_TITLES: Array<[string, string]> = [
  ["summary", "Summary"],
  ["root_cause", "Root cause"],
  ["timeline", "Timeline"],
  ["evidence", "Evidence"],
  ["fixes", "Suggested fixes"],
];

const NOT_ENABLED_HELP =
  "AI failure analysis is not enabled for this TestingBot account. The account owner can turn it on under " +
  "Account Settings > AI Analysis (https://testingbot.com/members/user/edit#ai-analysis); enabling it records " +
  "their consent to sending test logs to the AI provider. Until then, use getFailureLogs to read the logs directly.";

const POLL_INTERVAL_MS = 3_000;

const intArg = (min: number, max: number) =>
  z.union([z.number(), z.string().transform(Number)]).pipe(z.number().int().min(min).max(max));

const boolArg = () =>
  z.union([z.boolean(), z.string().transform((s) => s === "true")]).pipe(z.boolean());

function requireTestId(raw: string): string {
  const id = sanitizeSessionId(raw);
  if (!id) throw new Error("Test ID is empty after sanitization");
  return id;
}

function isNotEnabled(error: any): boolean {
  return error?.statusCode === 403 && error?.response?.code === "ai_analysis_not_enabled";
}

export function formatAnalysis(a: AiAnalysis): string {
  let out = `## AI failure analysis: ${a.session_id ?? a.test_id ?? ""}\n\n`;
  out += `**Status**: ${a.status}`;
  if (a.status === "complete") {
    out += ` · **Category**: ${a.category ?? "unknown"} · **Likely owner**: ${a.owner_class ?? "unknown"}`;
    out += ` · **Confidence**: ${a.confidence ?? "?"}/100 (${a.confidence_band ?? "?"})`;
    if (a.stale)
      out +=
        " · _stale: made by an older model, run analyzeTestFailure with force=true to refresh_";
  }
  if (a.status === "failed" && a.error) out += ` · **Error**: ${a.error}`;
  out += "\n";
  if (a.test_url) out += `**Dashboard**: ${a.test_url}\n`;
  out += "\n";

  const sections = a.sections ?? {};
  for (const [key, title] of SECTION_TITLES) {
    if (sections[key]) out += `### ${title}\n\n${sections[key]}\n\n`;
  }
  if (a.status === "none") {
    out += "_No analysis yet. Call analyzeTestFailure to start one._\n";
  } else if (a.status === "pending" || a.status === "running") {
    out += "_Still running. Call getAiFailureAnalysis again in a few seconds._\n";
  } else if (a.status === "complete") {
    out += "_AI analysis can be wrong; verify against the logs before acting on it._\n";
  }
  return out;
}

async function readAnalysis(testingBotApi: any, id: string): Promise<AiAnalysis> {
  return testingBotApi.request({
    method: "GET",
    url: `/tests/${encodeURIComponent(id)}/ai_analysis`,
  });
}

export default function addAiAnalysisTools(
  server: any,
  testingBotApi: any,
  _config: TestingBotConfig
) {
  const tools: Record<string, any> = {};

  tools.getAiFailureAnalysis = server.tool(
    "getAiFailureAnalysis",
    "Read the AI failure analysis (TestingBot AI Insights) of a test: summary, root cause, timeline, log evidence, suggested fixes, failure category, likely owner and confidence. Read-only: never starts an analysis or sends data to the AI provider. Requires the account owner to have enabled AI Analysis.",
    {
      sessionId: z.string().min(1).describe("Session ID (or numeric test ID) of the test."),
    },
    async (args: { sessionId: string }) => {
      try {
        const id = requireTestId(args.sessionId);
        const analysis = await readAnalysis(testingBotApi, id);
        return { content: [{ type: "text", text: formatAnalysis(analysis) }] };
      } catch (error) {
        if (isNotEnabled(error)) {
          return { content: [{ type: "text", text: NOT_ENABLED_HELP }], isError: true };
        }
        return handleMCPError("getAiFailureAnalysis", error);
      }
    }
  );

  tools.analyzeTestFailure = server.tool(
    "analyzeTestFailure",
    "Explain why a test failed with TestingBot AI Insights. Starts an AI failure analysis of a finished test (or returns the existing one without extra cost) and waits for the result. The test's curated, secret-masked logs are sent to TestingBot's AI provider, so this requires the account owner to have enabled AI Analysis in Account Settings. Use getFailureLogs instead when you want the raw logs.",
    {
      sessionId: z.string().min(1).describe("Session ID (or numeric test ID) of the test."),
      force: boolArg()
        .optional()
        .default(false)
        .describe(
          "Run a fresh analysis even when a current one exists (counts towards the account's AI limits)."
        ),
      waitSeconds: intArg(0, 180)
        .optional()
        .default(90)
        .describe(
          "How long to wait for the analysis to finish (default 90, 0 = return immediately)."
        ),
    },
    async (args: { sessionId: string; force?: boolean; waitSeconds?: number }) => {
      try {
        const id = requireTestId(args.sessionId);
        logger.info({ sessionId: id, force: args.force }, "Starting AI failure analysis");

        let analysis: AiAnalysis = await testingBotApi.request({
          method: "POST",
          url: `/tests/${encodeURIComponent(id)}/ai_analysis`,
          data: args.force ? { force: true } : {},
        });

        const deadline = Date.now() + (args.waitSeconds ?? 90) * 1000;
        while (
          (analysis.status === "pending" || analysis.status === "running") &&
          Date.now() < deadline
        ) {
          await sleep(POLL_INTERVAL_MS);
          analysis = await readAnalysis(testingBotApi, id);
        }

        return { content: [{ type: "text", text: formatAnalysis(analysis) }] };
      } catch (error) {
        if (isNotEnabled(error)) {
          return { content: [{ type: "text", text: NOT_ENABLED_HELP }], isError: true };
        }
        if ((error as any)?.statusCode === 409) {
          return {
            content: [
              {
                type: "text",
                text: "The test is still running. Analyze it once it has finished (check with getTestDetails).",
              },
            ],
            isError: true,
          };
        }
        return handleMCPError("analyzeTestFailure", error);
      }
    }
  );

  return tools;
}
