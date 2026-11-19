import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

// Scheduled accessibility scans via /v1/accessibility/* (testingbot/web#783):
// list tests and runs, read a run's findings (scored like the dashboard: WCAG
// A/AA violations decide pass/fail; best-practice recommendations and
// needs-review items do not), and start a scan.

const intArg = (min: number, max: number) =>
  z.union([z.number(), z.string().transform(Number)]).pipe(z.number().int().min(min).max(max));

interface Severity {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}

interface RunSummary {
  id: number;
  test_id: number;
  state: string;
  passed: boolean | null;
  score: number | null;
  wcag_issues_count: number | null;
  needs_review_count: number | null;
  recommendations_count: number | null;
  severity: Severity | null;
  created_at?: string;
  run_url?: string;
}

interface Rule {
  rule: string;
  impact?: string | null;
  help?: string | null;
  help_url?: string | null;
  wcag?: string[];
  elements_count: number;
  elements: Array<{
    target: string[];
    html?: string;
    impact?: string | null;
    failure_summary?: string | null;
  }>;
}

interface RunDetail extends RunSummary {
  violations: Rule[];
  recommendations: Rule[];
  needs_review: Rule[];
  new_violations: string[] | null;
  resolved_violations: string[] | null;
}

function runLine(run: RunSummary): string {
  if (run.state !== "done") return `- **#${run.id}** ${run.state} · ${run.created_at ?? ""}`;
  const s = run.severity;
  const sev = s
    ? ` (critical ${s.critical}, serious ${s.serious}, moderate ${s.moderate}, minor ${s.minor})`
    : "";
  return `- **#${run.id}** ${run.passed ? "passed" : "failed"} · score ${run.score} · ${run.wcag_issues_count} WCAG issue elements${sev} · ${run.needs_review_count} need review · ${run.created_at ?? ""}`;
}

function rulesSection(title: string, rules: Rule[]): string {
  if (rules.length === 0) return "";
  let out = `### ${title}\n\n`;
  for (const r of rules) {
    const wcag = r.wcag && r.wcag.length ? ` [${r.wcag.join(", ")}]` : "";
    out += `- **${r.rule}** (${r.impact ?? "n/a"})${wcag}: ${r.help ?? ""}. ${r.elements_count} element${r.elements_count === 1 ? "" : "s"}.${r.help_url ? ` ${r.help_url}` : ""}\n`;
    for (const el of r.elements) {
      out += `  - \`${el.target.join(" ")}\``;
      if (el.html) out += `: \`${el.html.replace(/`/g, "'").replace(/\s+/g, " ")}\``;
      out += "\n";
      if (el.failure_summary) {
        out += `    ${el.failure_summary.replace(/\s*\n\s*/g, " ")}\n`;
      }
    }
  }
  return out + "\n";
}

export function formatRunDetail(run: RunDetail): string {
  let out = `## Accessibility run #${run.id}\n\n${runLine(run)}\n\n`;
  if (run.run_url) out += `**Report**: ${run.run_url}\n\n`;
  if (run.state !== "done") return out + "_The scan has not finished._\n";

  if (run.new_violations) {
    out += `**Compared with the previous scan**: ${run.new_violations.length} new, ${run.resolved_violations?.length ?? 0} resolved`;
    if (run.new_violations.length) out += ` (new: ${run.new_violations.slice(0, 10).join(", ")})`;
    out += "\n\n";
  }
  out += rulesSection("WCAG A/AA violations", run.violations ?? []);
  out += rulesSection("Needs review", run.needs_review ?? []);
  out += rulesSection("Best-practice recommendations (not scored)", run.recommendations ?? []);
  out +=
    "_Automated checks cover only part of WCAG; a run without violations does not mean the page is compliant._\n";
  return out;
}

export default function addAccessibilityTools(
  server: any,
  testingBotApi: any,
  _config: TestingBotConfig
) {
  const tools: Record<string, any> = {};

  tools.getAccessibilityTests = server.tool(
    "getAccessibilityTests",
    "List the account's scheduled accessibility tests (each scans one URL on a schedule), with each test's name, ID, URL, whether it is paused, and its latest run. Read-only. Start here to find a `testId`; then use getAccessibilityRuns for a test's scan history, getAccessibilityFindings for what failed, or runAccessibilityTest to scan now. Paginate with `offset` / `limit` (max 100).",
    {
      offset: intArg(0, 100000).optional().default(0).describe("Skip this many tests."),
      limit: intArg(1, 100).optional().default(20).describe("Number of tests (max 100)."),
    },
    async (args: { offset?: number; limit?: number }) => {
      try {
        const body = await testingBotApi.request({
          method: "GET",
          url: "/accessibility/tests",
          data: { offset: args.offset ?? 0, count: args.limit ?? 20 },
        });
        const data: any[] = body?.data ?? [];
        if (data.length === 0) {
          return { content: [{ type: "text", text: "No accessibility tests found." }] };
        }
        let out = `## Accessibility tests (${data.length} of ${body?.meta?.total ?? data.length})\n\n`;
        for (const t of data) {
          out += `### ${t.name} (id ${t.id})${t.paused ? " · paused" : ""}\n${t.url}\n`;
          out += t.latest_run ? `${runLine(t.latest_run)}\n\n` : "_Not run yet._\n\n";
        }
        return { content: [{ type: "text", text: out }] };
      } catch (error) {
        return handleMCPError("getAccessibilityTests", error);
      }
    }
  );

  tools.getAccessibilityRuns = server.tool(
    "getAccessibilityRuns",
    "List the scans (runs) of one accessibility test, newest first, with each run's ID, score and issue counts. Read-only. Get `testId` from getAccessibilityTests. Use it to see whether a page got better or worse over time, or to find the `runId` to pass to getAccessibilityFindings. After runAccessibilityTest, poll this until the new run appears.",
    {
      testId: intArg(1, Number.MAX_SAFE_INTEGER).describe("ID of the accessibility test."),
      offset: intArg(0, 100000).optional().default(0).describe("Skip this many runs."),
      limit: intArg(1, 100).optional().default(10).describe("Number of runs (max 100)."),
    },
    async (args: { testId: number; offset?: number; limit?: number }) => {
      try {
        const body = await testingBotApi.request({
          method: "GET",
          url: `/accessibility/tests/${args.testId}/runs`,
          data: { offset: args.offset ?? 0, count: args.limit ?? 10 },
        });
        const runs: RunSummary[] = body?.data ?? [];
        if (runs.length === 0) return { content: [{ type: "text", text: "No runs yet." }] };
        return {
          content: [
            {
              type: "text",
              text: `## Runs of accessibility test ${args.testId}\n\n${runs.map(runLine).join("\n")}\n\nUse getAccessibilityFindings with a run id for the findings.\n`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("getAccessibilityRuns", error);
      }
    }
  );

  tools.getAccessibilityFindings = server.tool(
    "getAccessibilityFindings",
    "Show what an accessibility scan found: failing WCAG A/AA rules with the failing elements (CSS selector, HTML snippet, how to fix), checks that need human review, best-practice recommendations, and which issues are new or resolved since the previous scan. Read-only. Get `runId` from getAccessibilityRuns. Use it to fix issues; `elementsPerRule` (default 5, max 50) controls how many elements are listed per rule.",
    {
      runId: intArg(1, Number.MAX_SAFE_INTEGER).describe("ID of the accessibility run."),
      elementsPerRule: intArg(0, 50)
        .optional()
        .default(5)
        .describe("Failing elements listed per rule (default 5, max 50)."),
    },
    async (args: { runId: number; elementsPerRule?: number }) => {
      try {
        const run: RunDetail = await testingBotApi.request({
          method: "GET",
          url: `/accessibility/runs/${args.runId}`,
          data: { nodes: args.elementsPerRule ?? 5 },
        });
        return { content: [{ type: "text", text: formatRunDetail(run) }] };
      } catch (error) {
        return handleMCPError("getAccessibilityFindings", error);
      }
    }
  );

  tools.runAccessibilityTest = server.tool(
    "runAccessibilityTest",
    "Start a scan of a scheduled accessibility test right now, the same as Run now in the dashboard, instead of waiting for its schedule. Get `testId` from getAccessibilityTests. Returns as soon as the scan is queued, without results; poll getAccessibilityRuns until the new run appears, then read it with getAccessibilityFindings. Each call starts another scan.",
    {
      testId: intArg(1, Number.MAX_SAFE_INTEGER).describe("ID of the accessibility test."),
    },
    async (args: { testId: number }) => {
      try {
        logger.info({ testId: args.testId }, "Starting accessibility scan");
        await testingBotApi.request({
          method: "POST",
          url: `/accessibility/tests/${args.testId}/run`,
        });
        return {
          content: [
            {
              type: "text",
              text: `Accessibility scan of test ${args.testId} started. Check getAccessibilityRuns for the new run.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("runAccessibilityTest", error);
      }
    }
  );

  return tools;
}
