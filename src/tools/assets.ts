import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError, sanitizeSessionId } from "../lib/utils.js";
import logger from "../lib/logger.js";

// Tools for the files a session leaves behind, via GET /v1/tests/:id/assets:
// presigned URLs for the video, per-type log files, the HAR network capture,
// the performance samples and the screenshots. Video/log/HAR/performance URLs
// expire after an hour, so every tool fetches a fresh set instead of caching.

export interface TestAssets {
  session_id?: string;
  video?: string | null;
  logs?: Record<string, string> | null;
  har?: string | null;
  performance?: string | null;
  screenshots?: unknown[] | null;
}

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const URL_DISPLAY_CHARS = 200;

const intArg = (min: number, max: number) =>
  z.union([z.number(), z.string().transform(Number)]).pipe(z.number().int().min(min).max(max));

const boolArg = () =>
  z.union([z.boolean(), z.string().transform((s) => s === "true")]).pipe(z.boolean());

export async function fetchTestAssets(testingBotApi: any, sessionId: string): Promise<TestAssets> {
  const body = await testingBotApi.request({
    method: "GET",
    url: `/tests/${encodeURIComponent(sessionId)}/assets`,
  });
  return body && typeof body === "object" ? (body as TestAssets) : {};
}

async function download(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} downloading the file`);
    }
    const length = Number(response.headers?.get?.("content-length") ?? 0);
    if (length > MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `file is ${length} bytes, over the ${MAX_DOWNLOAD_BYTES} byte limit; download it from the URL instead`
      );
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

function requireSessionId(raw: string): string {
  const sessionId = sanitizeSessionId(raw);
  if (!sessionId) {
    throw new Error("Session ID is empty after sanitization");
  }
  return sessionId;
}

// --- HAR -------------------------------------------------------------------

interface HarRow {
  method: string;
  url: string;
  status: number;
  timeMs: number;
  bytes: number;
  mimeType: string;
}

export function parseHar(text: string): HarRow[] {
  const har = JSON.parse(text);
  const entries: any[] = Array.isArray(har?.log?.entries) ? har.log.entries : [];
  return entries.map((e) => ({
    method: String(e?.request?.method ?? ""),
    url: String(e?.request?.url ?? ""),
    status: Number(e?.response?.status ?? 0),
    timeMs: Math.round(Number(e?.time ?? 0)),
    bytes: Number(e?.response?.bodySize ?? e?.response?.content?.size ?? -1),
    mimeType: String(e?.response?.content?.mimeType ?? ""),
  }));
}

// Status 0 is how HAR records a request that never got a response (blocked,
// aborted, DNS or connection failure).
const isFailedRequest = (row: HarRow) => row.status === 0 || row.status >= 400;

function harRowLine(row: HarRow): string {
  const size = row.bytes >= 0 ? `${row.bytes} B` : "?";
  return `| ${row.method} | ${row.status || "failed"} | ${row.timeMs} ms | ${size} | ${shorten(row.url, URL_DISPLAY_CHARS)} |`;
}

// --- console ---------------------------------------------------------------

interface ConsoleEntry {
  level: string;
  message: string;
  timestamp?: number;
}

const LEVEL_RANK: Record<string, number> = { SEVERE: 3, ERROR: 3, WARNING: 2, WARN: 2 };

function entriesFrom(value: any): ConsoleEntry[] {
  const list = Array.isArray(value) ? value : Array.isArray(value?.value) ? value.value : null;
  if (!list) return [];
  return list
    .filter((e: any) => e && typeof e === "object" && "message" in e)
    .map((e: any) => ({
      level: String(e.level ?? "INFO").toUpperCase(),
      message: String(e.message),
      timestamp: typeof e.timestamp === "number" ? e.timestamp : undefined,
    }));
}

// The console log is the WebDriver log response ({"value":[{level, message,
// timestamp}]}), possibly several appended together. Returns null when the
// file is not in that shape, so the caller can fall back to plain text.
export function parseConsoleLog(text: string): ConsoleEntry[] | null {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    return entriesFrom(JSON.parse(trimmed));
  } catch {
    // fall through to per-chunk parsing
  }
  const chunks = trimmed.split(/(?<=\})\s*(?=\{)/);
  const entries: ConsoleEntry[] = [];
  let parsedAny = false;
  for (const chunk of chunks) {
    try {
      entries.push(...entriesFrom(JSON.parse(chunk)));
      parsedAny = true;
    } catch {
      // not JSON
    }
  }
  return parsedAny ? entries : null;
}

// --- performance -----------------------------------------------------------

interface SeriesStats {
  series: string;
  field: string;
  samples: number;
  min: number;
  avg: number;
  max: number;
}

// The performance file holds, per series (a process, or "Network"), an array
// of samples with numeric fields. Reports min/avg/max of every numeric field
// rather than assuming which fields exist.
export function summarizePerformance(data: unknown): SeriesStats[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const stats: SeriesStats[] = [];
  for (const [series, samples] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(samples)) continue;
    const fields = new Map<string, number[]>();
    for (const sample of samples) {
      if (!sample || typeof sample !== "object") continue;
      for (const [field, raw] of Object.entries(sample as Record<string, unknown>)) {
        const value = typeof raw === "number" ? raw : parseFloat(String(raw));
        if (!Number.isFinite(value)) continue;
        if (!fields.has(field)) fields.set(field, []);
        fields.get(field)!.push(value);
      }
    }
    for (const [field, values] of fields) {
      const sum = values.reduce((a, b) => a + b, 0);
      stats.push({
        series,
        field,
        samples: values.length,
        min: Math.min(...values),
        avg: sum / values.length,
        max: Math.max(...values),
      });
    }
  }
  return stats;
}

const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export default function addAssetTools(server: any, testingBotApi: any, _config: TestingBotConfig) {
  const tools: Record<string, any> = {};

  tools.getTestAssets = server.tool(
    "getTestAssets",
    "List the files a test session produced: video, each log file (selenium, browser console, driver, appium, logcat, …), the HAR network capture, performance samples and screenshots, as download URLs. Video, log, HAR and performance URLs expire after one hour; call again for fresh ones. Use getNetworkLog, getConsoleLogs or getPerformanceMetrics to read the HAR, console and performance files.",
    {
      sessionId: z.string().min(1).describe("The session ID (or numeric ID) of the test"),
    },
    async (args: { sessionId: string }) => {
      try {
        const sessionId = requireSessionId(args.sessionId);
        logger.info({ sessionId }, "Fetching test assets");
        const assets = await fetchTestAssets(testingBotApi, sessionId);

        const logs = assets.logs && typeof assets.logs === "object" ? assets.logs : {};
        const screenshots = Array.isArray(assets.screenshots) ? assets.screenshots : [];

        let output = `## Test Assets: ${sessionId}\n\n`;
        output += `- **Video**: ${assets.video || "_not available_"}\n`;
        output += `- **HAR network capture**: ${assets.har || "_not available_"}\n`;
        output += `- **Performance samples**: ${assets.performance || "_not available_"}\n`;
        output += `- **Screenshots**: ${screenshots.length}\n\n`;

        const logTypes = Object.keys(logs);
        output += "### Log files\n";
        if (logTypes.length === 0) {
          output += "_none available_\n";
        } else {
          for (const type of logTypes) {
            const label = type === "browser" ? "browser (console)" : type;
            output += `- **${label}**: ${logs[type]}\n`;
          }
        }
        output +=
          "\n_Video, log, HAR and performance URLs expire after one hour. Assets can take a short while to appear after a test ends._\n";

        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return handleMCPError("getTestAssets", error);
      }
    }
  );

  tools.getNetworkLog = server.tool(
    "getNetworkLog",
    "Read a test's HAR network capture and summarize its requests: method, status, duration, size and URL. Highlights failed requests (HTTP 4xx/5xx or no response) and the slowest ones. Only sessions that recorded network traffic have a HAR file.",
    {
      sessionId: z.string().min(1).describe("The session ID (or numeric ID) of the test"),
      failedOnly: boolArg()
        .optional()
        .default(false)
        .describe("If true, list only failed requests (HTTP 4xx/5xx, or no response)."),
      urlContains: z
        .string()
        .optional()
        .describe("Only list requests whose URL contains this text (case-insensitive)."),
      limit: intArg(1, 500)
        .optional()
        .default(50)
        .describe("Maximum number of requests to list (default 50, max 500)."),
      timeoutMs: intArg(1000, 120_000)
        .optional()
        .default(30_000)
        .describe("Download timeout in milliseconds (default 30000)."),
    },
    async (args: {
      sessionId: string;
      failedOnly?: boolean;
      urlContains?: string;
      limit?: number;
      timeoutMs?: number;
    }) => {
      try {
        const sessionId = requireSessionId(args.sessionId);
        logger.info({ sessionId, failedOnly: args.failedOnly }, "Fetching network log");
        const assets = await fetchTestAssets(testingBotApi, sessionId);
        if (!assets.har) {
          return {
            content: [
              {
                type: "text",
                text: `## Network Log: ${sessionId}\n\nThis session has no HAR network capture. Only sessions that captured network traffic have one, and assets can take a short while to appear after a test ends.\n`,
              },
            ],
          };
        }

        let rows: HarRow[];
        try {
          rows = parseHar(await download(assets.har, args.timeoutMs ?? 30_000));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `## Network Log: ${sessionId}\n\nCould not read the HAR file: ${message}\n\nDownload it directly (valid for one hour): ${assets.har}\n`,
              },
            ],
            isError: true,
          };
        }

        const failed = rows.filter(isFailedRequest);
        const needle = args.urlContains?.toLowerCase();
        let selected = args.failedOnly ? failed : rows;
        if (needle) selected = selected.filter((r) => r.url.toLowerCase().includes(needle));
        const limit = args.limit ?? 50;

        let output = `## Network Log: ${sessionId}\n\n`;
        output += `**Requests**: ${rows.length} · **Failed**: ${failed.length}\n\n`;

        if (!args.failedOnly && !needle && rows.length > 0) {
          const slowest = [...rows].sort((a, b) => b.timeMs - a.timeMs).slice(0, 5);
          output +=
            "### Slowest requests\n| Method | Status | Time | Size | URL |\n|---|---|---|---|---|\n";
          output += slowest.map(harRowLine).join("\n") + "\n\n";
        }

        const heading = args.failedOnly ? "Failed requests" : "Requests";
        output += `### ${heading}${needle ? ` matching "${args.urlContains}"` : ""} (${Math.min(selected.length, limit)} of ${selected.length})\n`;
        if (selected.length === 0) {
          output += "_none_\n";
        } else {
          output += "| Method | Status | Time | Size | URL |\n|---|---|---|---|---|\n";
          output += selected.slice(0, limit).map(harRowLine).join("\n") + "\n";
        }
        output += `\n_Full HAR (valid for one hour): ${assets.har}_\n`;

        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return handleMCPError("getNetworkLog", error);
      }
    }
  );

  tools.getConsoleLogs = server.tool(
    "getConsoleLogs",
    "Read the browser console log of a test (JavaScript errors, warnings and console messages captured from the browser). Use minLevel to keep only errors or warnings. Not every browser or session produces a console log.",
    {
      sessionId: z.string().min(1).describe("The session ID (or numeric ID) of the test"),
      minLevel: z
        .enum(["all", "warning", "error"])
        .optional()
        .default("all")
        .describe(
          "Lowest level to include: 'error' (SEVERE only), 'warning' (WARNING and SEVERE) or 'all'."
        ),
      limit: intArg(1, 1000)
        .optional()
        .default(200)
        .describe("Maximum number of entries to return, newest last (default 200, max 1000)."),
      timeoutMs: intArg(1000, 60_000)
        .optional()
        .default(15_000)
        .describe("Download timeout in milliseconds (default 15000)."),
    },
    async (args: {
      sessionId: string;
      minLevel?: "all" | "warning" | "error";
      limit?: number;
      timeoutMs?: number;
    }) => {
      try {
        const sessionId = requireSessionId(args.sessionId);
        logger.info({ sessionId, minLevel: args.minLevel }, "Fetching console logs");
        const assets = await fetchTestAssets(testingBotApi, sessionId);
        const url =
          assets.logs && typeof assets.logs === "object" ? assets.logs.browser : undefined;
        if (!url) {
          return {
            content: [
              {
                type: "text",
                text: `## Console Logs: ${sessionId}\n\nThis session has no browser console log. Not every browser or session type produces one, and assets can take a short while to appear after a test ends.\n`,
              },
            ],
          };
        }

        const text = await download(url, args.timeoutMs ?? 15_000);
        const minRank = args.minLevel === "error" ? 3 : args.minLevel === "warning" ? 2 : 0;
        const limit = args.limit ?? 200;
        const entries = parseConsoleLog(text);

        let output = `## Console Logs: ${sessionId}\n\n`;
        if (entries === null) {
          // Not in the structured format: return the tail as text, filtered by keyword.
          let lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
          if (minRank >= 3) lines = lines.filter((l) => /\b(SEVERE|ERROR)\b/i.test(l));
          else if (minRank === 2)
            lines = lines.filter((l) => /\b(SEVERE|ERROR|WARN(ING)?)\b/i.test(l));
          const shown = lines.slice(-limit);
          output += `${shown.length} of ${lines.length} lines\n\n\`\`\`\n${shown.join("\n")}\n\`\`\`\n`;
        } else {
          const kept = entries.filter((e) => (LEVEL_RANK[e.level] ?? 0) >= minRank);
          const counts = entries.reduce<Record<string, number>>((acc, e) => {
            acc[e.level] = (acc[e.level] ?? 0) + 1;
            return acc;
          }, {});
          const summary = Object.entries(counts)
            .map(([level, n]) => `${level}: ${n}`)
            .join(" · ");
          output += `**Entries**: ${entries.length}${summary ? ` (${summary})` : ""}\n\n`;
          const shown = kept.slice(-limit);
          if (shown.length === 0) {
            output += "_no entries at this level_\n";
          } else {
            output += "```\n";
            output += shown
              .map((e) => {
                const ts = e.timestamp ? new Date(e.timestamp).toISOString() + " " : "";
                return `${ts}[${e.level}] ${e.message}`;
              })
              .join("\n");
            output += "\n```\n";
          }
        }

        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return handleMCPError("getConsoleLogs", error);
      }
    }
  );

  tools.getPerformanceMetrics = server.tool(
    "getPerformanceMetrics",
    "Summarize the performance samples recorded during a test (the data behind the Performance tab of the test in the TestingBot dashboard, such as CPU, memory and network usage over time): sample count and min/avg/max per series. Only sessions that recorded performance data have it.",
    {
      sessionId: z.string().min(1).describe("The session ID (or numeric ID) of the test"),
      timeoutMs: intArg(1000, 60_000)
        .optional()
        .default(15_000)
        .describe("Download timeout in milliseconds (default 15000)."),
    },
    async (args: { sessionId: string; timeoutMs?: number }) => {
      try {
        const sessionId = requireSessionId(args.sessionId);
        logger.info({ sessionId }, "Fetching performance metrics");
        const assets = await fetchTestAssets(testingBotApi, sessionId);
        if (!assets.performance) {
          return {
            content: [
              {
                type: "text",
                text: `## Performance: ${sessionId}\n\nThis session has no performance data.\n`,
              },
            ],
          };
        }

        const text = await download(assets.performance, args.timeoutMs ?? 15_000);
        let stats: SeriesStats[] = [];
        try {
          stats = summarizePerformance(JSON.parse(text));
        } catch {
          stats = [];
        }

        let output = `## Performance: ${sessionId}\n\n`;
        if (stats.length === 0) {
          output += `The performance file is not in a format this tool can summarize. First 2000 characters:\n\n\`\`\`\n${text.slice(0, 2000)}\n\`\`\`\n`;
        } else {
          output += "| Series | Field | Samples | Min | Avg | Max |\n|---|---|---|---|---|---|\n";
          output += stats
            .map(
              (s) =>
                `| ${s.series} | ${s.field} | ${s.samples} | ${round(s.min)} | ${round(s.avg)} | ${round(s.max)} |`
            )
            .join("\n");
          output += "\n";
        }
        output += `\n_Raw file (valid for one hour): ${assets.performance}_\n`;

        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return handleMCPError("getPerformanceMetrics", error);
      }
    }
  );

  return tools;
}
