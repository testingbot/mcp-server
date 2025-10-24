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

export class TestingBotMcpServer {
  public server: McpServer;
  public tools: Record<string, any> = {};
  private testingBotApi: any;
  private config: TestingBotConfig;

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
          tools: {},
        },
      }
    );

    this.registerTools();
    this.setupHandlers();
  }

  private setupHandlers() {
    // Handle tools/list request
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Object.values(this.tools).map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: {
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

      const tool = this.tools[toolName];
      if (!tool) {
        throw new Error(`Tool not found: ${toolName}`);
      }

      return tool.handler(toolArgs);
    });
  }

  private registerTools() {
    const toolAdders = [
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
    ];

    toolAdders.forEach((adder) => {
      const addedTools = adder(this, this.testingBotApi, this.config);
      Object.assign(this.tools, addedTools);
    });

    logger.info({ toolCount: Object.keys(this.tools).length }, "Tools registered");
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

  public async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info("TestingBot MCP Server running on stdio");
  }
}
