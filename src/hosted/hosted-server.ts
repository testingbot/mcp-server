import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "module";
import { TestingBotConfig } from "../lib/types.js";
import { toolInputSchema } from "../lib/tool-schema.js";
import addBrowserTools from "../tools/browsers.js";
import addTestTools from "../tools/tests.js";
import addBuildTools from "../tools/builds.js";
import addStorageTools from "../tools/storage.js";
import addScreenshotTools from "../tools/screenshots.js";
import addUserTools from "../tools/user.js";
import addLiveTools from "../tools/live.js";
import addTunnelTools from "../tools/tunnels.js";
import addLogTools from "../tools/logs.js";
import addMaestroTools from "../tools/maestro.js";
import addAppAutomateTools from "../tools/app-automate.js";
import { annotationsFor, HostedToolPolicy } from "./tool-policy.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json");

// ChatGPT shows only the first 512 characters; keep them self-contained.
export const HOSTED_INSTRUCTIONS =
  "TestingBot is a cloud testing platform. These tools read and manage the signed-in user's TestingBot " +
  "account: Selenium/Playwright test results, builds, screenshots, stored apps, tunnels, and Maestro, " +
  "Espresso and XCUITest runs on real and virtual devices. Runs are asynchronous: start one, then poll its " +
  "status tool. Tools that start or change something use the user's minutes; confirm with the user first. " +
  "Local files cannot be uploaded here; use the local npx @testingbot/mcp-server for that.";

export const TOOL_TIMEOUT_MS = 60_000;

type ToolDef = {
  name: string;
  description: string;
  schema: any;
  handler: (args: any) => Promise<any>;
};

const ADDERS = [
  addBrowserTools,
  addTestTools,
  addBuildTools,
  addStorageTools,
  addScreenshotTools,
  addUserTools,
  addLiveTools,
  addTunnelTools,
  addLogTools,
  addMaestroTools,
  addAppAutomateTools,
];

// Builds the hosted tool set bound to one request's API client. The adders
// only use `server.tool(...)` to describe a tool, so a tiny host stands in for
// the stdio server class.
export function buildHostedTools(
  api: any,
  config: TestingBotConfig,
  policies: Record<string, HostedToolPolicy>
): Record<string, ToolDef> {
  const host = {
    tool: (
      name: string,
      description: string,
      schema: any,
      handler: (args: any) => Promise<any>
    ) => ({
      name,
      description,
      schema,
      handler,
    }),
  };
  const all: Record<string, ToolDef> = {};
  for (const adder of ADDERS) Object.assign(all, (adder as any)(host, api, config));

  const tools: Record<string, ToolDef> = {};
  for (const name of Object.keys(policies)) {
    if (all[name]) tools[name] = all[name];
  }

  // Inline content only: a chat client has no filesystem, and a path would be
  // read from the server's own disk.
  if (tools.uploadMaestroFlows) {
    const inner = tools.uploadMaestroFlows.handler;
    tools.uploadMaestroFlows = {
      ...tools.uploadMaestroFlows,
      description:
        "Upload Maestro flow YAML files for a project as inline content (fileName + content). Replaces any previously uploaded flows for the project.",
      handler: async (args: any) => {
        if (args?.flowsPath) {
          return errorResult(
            "flowsPath is not available on the hosted server. Pass the flows inline with `flows`."
          );
        }
        return inner(args);
      },
    };
  }
  return tools;
}

export function errorResult(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}

export function listHostedTools(
  tools: Record<string, ToolDef>,
  policies: Record<string, HostedToolPolicy>
) {
  return Object.values(tools).map((t) => {
    const { title, ...annotations } = annotationsFor(policies[t.name]);
    return {
      name: t.name,
      title,
      description: t.description,
      inputSchema: toolInputSchema(t.schema),
      annotations: { title, ...annotations },
    };
  });
}

// One MCP server per HTTP request (stateless mode). `onToolCall` lets the HTTP
// layer log and time each call.
export function createHostedMcpServer(opts: {
  api: any;
  config: TestingBotConfig;
  policies: Record<string, HostedToolPolicy>;
  timeoutMs?: number;
  onToolCall?: (name: string, ms: number, isError: boolean) => void;
}): McpServer {
  const tools = buildHostedTools(opts.api, opts.config, opts.policies);
  const server = new McpServer(
    { name: packageJson.name, version: packageJson.version, title: "TestingBot" },
    { capabilities: { tools: {} }, instructions: HOSTED_INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listHostedTools(tools, opts.policies),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const tool = tools[name];
    if (!tool) return errorResult(`Tool not available on the hosted server: ${name}`);

    const started = Date.now();
    let result: any;
    try {
      result = await withTimeout(
        tool.handler(request.params.arguments || {}),
        opts.timeoutMs ?? TOOL_TIMEOUT_MS
      );
    } catch (error) {
      result = errorResult(error instanceof Error ? error.message : String(error));
    }
    opts.onToolCall?.(name, Date.now() - started, Boolean(result?.isError));
    return result;
  });

  return server;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | any> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(
      () =>
        resolve(
          errorResult(
            `The tool did not finish within ${Math.round(ms / 1000)} s. If it started a run, poll its status tool.`
          )
        ),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
