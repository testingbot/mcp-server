import { sanitizeSessionId } from "./lib/utils.js";

// MCP resources (resources/list, resources/templates/list, resources/read):
// read-only TestingBot data a client can attach to a conversation.
//
//   testingbot://tests/{sessionId}                  test details (JSON)
//   testingbot://tests/{sessionId}/logs/{logType}   one session log (text, tail)
//   testingbot://builds/{buildId}                   tests in a build (JSON)
//   testingbot://insights/flaky-tests               most flaky tests (JSON)

const LOG_TYPES = ["selenium", "browser", "chrome", "vm", "appium"];
const MAX_LOG_BYTES = 200_000;
const LOG_TIMEOUT_MS = 15_000;

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: "testingbot://tests/{sessionId}",
    name: "test",
    title: "TestingBot test",
    description:
      "Status, environment, duration, build and asset links of one test (session ID or numeric test ID).",
    mimeType: "application/json",
  },
  {
    uriTemplate: "testingbot://tests/{sessionId}/logs/{logType}",
    name: "test-log",
    title: "TestingBot test log",
    description: `One log file of a test, the last ${MAX_LOG_BYTES / 1000} KB. logType: ${LOG_TYPES.join(", ")}.`,
    mimeType: "text/plain",
  },
  {
    uriTemplate: "testingbot://builds/{buildId}",
    name: "build",
    title: "TestingBot build",
    description: "The tests in a build with their status.",
    mimeType: "application/json",
  },
];

export const STATIC_RESOURCES = [
  {
    uri: "testingbot://insights/flaky-tests",
    name: "flaky-tests",
    title: "Flaky tests",
    description:
      "Tests that both passed and failed in the last 30 days, most flaky first. Add ?time_range=7d to change the window.",
    mimeType: "application/json",
  },
];

type Contents = { uri: string; mimeType: string; text: string };

function json(uri: string, body: unknown): Contents {
  return { uri, mimeType: "application/json", text: JSON.stringify(body, null, 2) };
}

function cleanId(raw: string): string {
  const id = sanitizeSessionId(decodeURIComponent(raw));
  if (!id) throw new Error("Empty ID in resource URI");
  return id;
}

async function fetchLogTail(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(LOG_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching log`);
  const text = await response.text();
  if (text.length <= MAX_LOG_BYTES) return text;
  return `… (truncated ${text.length - MAX_LOG_BYTES} bytes) …\n` + text.slice(-MAX_LOG_BYTES);
}

export async function readResource(
  testingBotApi: any,
  uri: string
): Promise<{ contents: Contents[] }> {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Invalid resource URI: ${uri}`);
  }
  if (parsed.protocol !== "testingbot:") throw new Error(`Unknown resource URI: ${uri}`);

  // For testingbot://tests/abc the "host" is "tests" and the path is "/abc".
  const parts = [parsed.host, ...parsed.pathname.split("/").filter(Boolean)];

  if (parts[0] === "tests" && parts.length === 2) {
    const test = await testingBotApi.getTestDetails(cleanId(parts[1]), {
      skip_fields: "steps",
    });
    return { contents: [json(uri, test)] };
  }

  if (parts[0] === "tests" && parts.length === 4 && parts[2] === "logs") {
    const id = cleanId(parts[1]);
    const logType = parts[3];
    if (!LOG_TYPES.includes(logType)) {
      throw new Error(`Unknown log type "${logType}". Use one of: ${LOG_TYPES.join(", ")}`);
    }
    const test = await testingBotApi.getTestDetails(id);
    const url = test?.logs && typeof test.logs === "object" ? test.logs[logType] : undefined;
    if (!url) throw new Error(`Test ${id} has no ${logType} log`);
    return { contents: [{ uri, mimeType: "text/plain", text: await fetchLogTail(url) }] };
  }

  if (parts[0] === "builds" && parts.length === 2) {
    const tests = await testingBotApi.getTestsForBuild(cleanId(parts[1]));
    return { contents: [json(uri, tests)] };
  }

  if (parts[0] === "insights" && parts[1] === "flaky-tests" && parts.length === 2) {
    const range = parsed.searchParams.get("time_range") || "30d";
    if (!/^\d{1,3}[hdw]$/.test(range)) throw new Error("time_range must look like 24h, 7d or 4w");
    const body = await testingBotApi.request({
      method: "GET",
      url: "/insights/test-cases",
      data: { sort: "flaky", sort_order: "desc", time_range: range, count: 50 },
    });
    const rows = Array.isArray(body?.data) ? body.data.filter((r: any) => r?.flaky) : [];
    return { contents: [json(uri, { time_range: range, flaky_tests: rows, meta: body?.meta })] };
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}
