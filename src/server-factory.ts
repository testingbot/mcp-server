import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TestingBotConfig } from "./lib/types.js";
import logger from "./lib/logger.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

import addBrowserTools from "./tools/browsers.js";
import addTestTools from "./tools/tests.js";
import addBuildTools from "./tools/builds.js";
import addStorageTools from "./tools/storage.js";
import addScreenshotTools from "./tools/screenshots.js";
import addUserTools from "./tools/user.js";
import addLiveTools from "./tools/live.js";
import addTeamTools from "./tools/team.js";
import addCdpTools from "./tools/cdp.js";
import addTunnelTools from "./tools/tunnels.js";
import addLogTools from "./tools/logs.js";
import addProjectTools from "./tools/project.js";
import addAuthTools from "./tools/auth.js";
import { addAutomationTools, type AutomationHandle } from "@testingbot/automation-mcp";

export class TestingBotMcpServer {
  public server: McpServer;
  public tools: Record<string, any> = {};
  private testingBotApi: any;
  private config: TestingBotConfig;
  private automation: AutomationHandle | null = null;
  private closing = false;

  constructor(testingBotApi: any, config: TestingBotConfig) {
    this.testingBotApi = testingBotApi;
    this.config = config;

    this.server = new McpServer(
      {
        name: packageJson.name || "testingbot-mcp-server",
        version: packageJson.version || "1.0.0",
      },
      {
        capabilities: {
          // listChanged lets us notify clients when tb_login re-registers
          // credential-dependent (automation) tools after a successful login.
          tools: { listChanged: true },
        },
      }
    );

    this.registerLocalTools();
    this.setupHandlers();
  }

  private setupHandlers() {
    // Handle tools/list request
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Object.values(this.tools).map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          // Proxied tools (e.g. appium-mcp) pre-stash a raw JSON Schema on the
          // tool object. Honor it; otherwise serialize the Zod-style dict.
          inputSchema: tool.inputSchema ?? {
            type: "object",
            properties: tool.schema,
            required: Object.keys(tool.schema).filter((key) => !tool.schema[key].isOptional?.()),
          },
        })),
      };
    });

    // Handle tools/call request
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const toolArgs = request.params.arguments || {};

      logger.info({ tool: toolName, args: toolArgs }, "Tool called");

      return this.handleToolCall(toolName, toolArgs);
    });
  }

  // Dispatch a single tool call, applying the degraded-mode credential gate.
  // Extracted from the request handler so the gate is unit-testable.
  public async handleToolCall(toolName: string, toolArgs: any): Promise<any> {
    const tool = this.tools[toolName];
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    // Degraded mode: with no credentials yet, every tool except the device-auth
    // flow reports how to authenticate instead of failing with an opaque API
    // error. Checked per-call so it clears the moment tb_login writes
    // credentials (which mutates this.config) — no restart required.
    if (toolName !== "tb_login" && !this.hasCredentials()) {
      return {
        content: [
          {
            type: "text",
            text: "No TestingBot credentials configured. Run the tb_login tool to authenticate (no API key needed), or set TESTINGBOT_KEY and TESTINGBOT_SECRET.",
          },
        ],
        isError: true,
      };
    }

    return tool.handler(toolArgs);
  }

  private hasCredentials(): boolean {
    return Boolean(this.config["testingbot-key"] && this.config["testingbot-secret"]);
  }

  // Called by the tb_login tool after a successful login. Credential-dependent
  // tools from @testingbot/automation-mcp bind their key/secret at registration,
  // so they're stale (or, in degraded startup, absent). Re-register them with the
  // now-valid credentials and tell the client the tool list changed. Best-effort:
  // failures here must not break the login that just succeeded.
  public async reinitializeAfterLogin(): Promise<void> {
    if (this.closing) return;
    try {
      // Spawn the new automation handle into a local FIRST so this.automation is
      // never null mid-flight (which would let a concurrent close() skip shutting
      // down the old child while a new one is being spawned → orphaned process).
      const previous = this.automation;
      const next = await addAutomationTools(this, this.testingBotApi, this.config);

      // If the server began shutting down while we were spawning, don't install
      // the new handle — tear it down so we don't leak its appium child.
      if (this.closing) {
        await next.shutdown();
        return;
      }

      this.automation = next;
      Object.assign(this.tools, next.tools);
      if (previous) await previous.shutdown();

      try {
        await this.server.sendToolListChanged();
      } catch {
        // Client may not support list-changed notifications; harmless.
      }
      logger.info("Re-registered credential-dependent tools after login");
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Failed to re-register automation tools after login; a client restart may be needed for them"
      );
    }
  }

  private registerLocalTools() {
    const toolAdders = [
      addAuthTools,
      addBrowserTools,
      addTestTools,
      addBuildTools,
      addStorageTools,
      addScreenshotTools,
      addUserTools,
      addLiveTools,
      addTeamTools,
      addCdpTools,
      addTunnelTools,
      addLogTools,
      addProjectTools,
    ];

    toolAdders.forEach((adder) => {
      const addedTools = adder(this, this.testingBotApi, this.config);
      Object.assign(this.tools, addedTools);
    });

    logger.info({ toolCount: Object.keys(this.tools).length }, "Local tools registered");
  }

  /**
   * Async tool registration. Currently this spawns the appium-mcp child
   * process bundled with @testingbot/automation-mcp and proxies its full
   * mobile tool surface onto this server. Must complete before the MCP
   * client requests its first tools/list.
   */
  private async registerAutomationTools() {
    this.automation = await addAutomationTools(this, this.testingBotApi, this.config);
    Object.assign(this.tools, this.automation.tools);
    logger.info({ toolCount: Object.keys(this.tools).length }, "All tools registered");
  }

  public tool(
    name: string,
    description: string,
    schema: any,
    handler: (args: any) => Promise<any>
  ) {
    const tool = {
      name,
      description,
      schema,
      handler,
    };

    return tool;
  }

  // Validates the runtime environment and credentials before accepting MCP
  // traffic. Throws on any blocking issue so the entry point can exit with a
  // clear error instead of letting the first tool call fail mysteriously.
  public async preflight(): Promise<void> {
    const required = 18;
    const major = Number(process.versions.node.split(".")[0]);
    if (!Number.isFinite(major) || major < required) {
      throw new Error(
        `Node.js ${required}+ is required; this process is running ${process.versions.node}. Upgrade Node (e.g. via nvm or https://nodejs.org) and re-run.`
      );
    }

    // No credentials yet: start anyway in degraded mode. The tb_login tool is
    // always available, and every other tool reports "Run tb_login" until creds
    // exist. This makes first-run self-healing instead of a hard crash.
    if (!this.hasCredentials()) {
      logger.warn(
        "No TestingBot credentials configured — starting in degraded mode. Run the tb_login tool to authenticate, or set TESTINGBOT_KEY and TESTINGBOT_SECRET (or TB_KEY/TB_SECRET)."
      );
      return;
    }

    try {
      await this.testingBotApi.getUserInfo();
      logger.info("Credentials verified against TestingBot API");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `TestingBot credential check failed: ${message}. Verify TESTINGBOT_KEY / TESTINGBOT_SECRET in the MCP client config.`
      );
    }
  }

  public async run() {
    await this.preflight();
    await this.registerAutomationTools();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info("TestingBot MCP Server running on stdio");
  }

  public async close() {
    // Signal any in-flight reinitializeAfterLogin to abort before installing /
    // spawning a new automation child, so we don't leak an orphaned process.
    this.closing = true;
    try {
      // Close any live automation sessions first — they hold remote resources
      // (TestingBot minutes) that we want released before the MCP transport drops.
      if (this.automation) {
        await this.automation.shutdown();
      }
      await this.server.close();
    } catch (error) {
      logger.error({ error }, "Error while closing MCP server");
    }
  }
}
