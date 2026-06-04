import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError, sanitizeSessionId } from "../lib/utils.js";
import logger from "../lib/logger.js";

const SUPPORTED_LOG_TYPES = ["selenium", "browser", "chrome", "vm", "appium"] as const;
type LogType = (typeof SUPPORTED_LOG_TYPES)[number];

// Heuristic: classify a single log line as failure-relevant. Conservative on
// false positives (e.g. ignores HTTP 200 / "OK") and matches stack-trace
// shapes from Java, Python, JS, and Ruby drivers.
const FAILURE_PATTERN =
  /\b(error|exception|failed|failure|traceback|stacktrace|fatal|panic|assertion|timeout|crash|refused|unreachable)\b|\bHTTP\/\S+\s+(4\d\d|5\d\d)\b|\bat [\w$.<>]+\([^)]+:\d+/i;

function isFailureLine(line: string): boolean {
  return FAILURE_PATTERN.test(line);
}

async function fetchLog(url: string, maxBytes: number, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching log`);
  }
  const text = await response.text();
  if (text.length <= maxBytes) return text;
  // Keep the tail — failure context lives near the end of a log file.
  return `… (truncated ${text.length - maxBytes} bytes) …\n` + text.slice(text.length - maxBytes);
}

function selectLines(content: string, failuresOnly: boolean): string {
  if (!failuresOnly) return content;
  const lines = content.split(/\r?\n/);
  const matches: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isFailureLine(lines[i])) {
      // Include 1 line of context above and below for readability.
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 2);
      matches.push(lines.slice(start, end).join("\n"));
    }
  }
  if (matches.length === 0) return "(no failure-relevant lines matched)";
  // De-duplicate adjacent overlapping context windows.
  return [...new Set(matches)].join("\n---\n");
}

export default function addLogTools(server: any, testingBotApi: any, _config: TestingBotConfig) {
  const tools: Record<string, any> = {};

  tools.getFailureLogs = server.tool(
    "getFailureLogs",
    "Fetch and return session log file content (selenium, browser, chrome, vm, appium) for a test by session ID. Use this to debug failures — pass failuresOnly=true to extract only error/exception/stack-trace lines.",
    {
      sessionId: z.string().min(1).describe("The session ID of the test"),
      logTypes: z
        .array(z.enum(SUPPORTED_LOG_TYPES))
        .optional()
        .describe(
          `Which log types to fetch. Defaults to every type available on the test. Valid: ${SUPPORTED_LOG_TYPES.join(", ")}.`
        ),
      failuresOnly: z
        .union([z.boolean(), z.string().transform((s) => s === "true")])
        .pipe(z.boolean())
        .optional()
        .default(false)
        .describe(
          "If true, only return lines that match error/exception/stack-trace patterns (plus 1 line of context above/below)."
        ),
      maxBytesPerLog: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().min(1000).max(1_000_000))
        .optional()
        .default(50_000)
        .describe(
          "Truncate each log to the last N bytes (default 50000, max 1000000). Failure context typically lives near the end."
        ),
      timeoutMs: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().min(1000).max(60_000))
        .optional()
        .default(15_000)
        .describe("Per-log fetch timeout in milliseconds (default 15000)."),
    },
    async (args: {
      sessionId: string;
      logTypes?: LogType[];
      failuresOnly?: boolean;
      maxBytesPerLog?: number;
      timeoutMs?: number;
    }) => {
      try {
        const sessionId = sanitizeSessionId(args.sessionId);
        if (!sessionId) {
          throw new Error("Session ID is empty after sanitization");
        }

        logger.info(
          { sessionId, logTypes: args.logTypes, failuresOnly: args.failuresOnly },
          "Fetching failure logs"
        );

        const test = await testingBotApi.getTestDetails(sessionId);
        const logMap: Record<string, string> =
          test?.logs && typeof test.logs === "object" ? test.logs : {};

        const requested: LogType[] =
          args.logTypes && args.logTypes.length > 0
            ? args.logTypes
            : (SUPPORTED_LOG_TYPES.filter((t) => logMap[t]) as LogType[]);

        if (requested.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `## Failure Logs: ${sessionId}\n\nNo log URLs available for this session. Logs may still be processing, or the test never produced them.\n`,
              },
            ],
          };
        }

        const maxBytes = args.maxBytesPerLog ?? 50_000;
        const failuresOnly = args.failuresOnly ?? false;
        const timeoutMs = args.timeoutMs ?? 15_000;

        const sections = await Promise.all(
          requested.map(async (logType) => {
            const url = logMap[logType];
            if (!url) return { logType, status: "missing" as const };

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              const raw = await fetchLog(url, maxBytes, controller.signal);
              const filtered = selectLines(raw, failuresOnly);
              return { logType, status: "ok" as const, url, content: filtered };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return { logType, status: "error" as const, url, error: message };
            } finally {
              clearTimeout(timer);
            }
          })
        );

        let output = `## Failure Logs: ${sessionId}\n\n`;
        output += `**Mode**: ${failuresOnly ? "failures only" : "full"} · **Max bytes/log**: ${maxBytes}\n\n`;

        for (const section of sections) {
          output += `### ${section.logType}\n`;
          if (section.status === "missing") {
            output += "_not available for this session_\n\n";
            continue;
          }
          if (section.status === "error") {
            output += `_fetch failed: ${section.error}_\n_url: ${section.url}_\n\n`;
            continue;
          }
          output += `**Source**: ${section.url}\n\n\`\`\`\n${section.content}\n\`\`\`\n\n`;
        }

        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error) {
        return handleMCPError("getFailureLogs", error);
      }
    }
  );

  return tools;
}
