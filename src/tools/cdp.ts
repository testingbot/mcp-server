import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

export default function addCdpTools(server: any, testingBotApi: any, _config: TestingBotConfig) {
  const tools: Record<string, any> = {};

  tools.createCdpSession = server.tool(
    "createCdpSession",
    "Start a remote browser on TestingBot and return its Chrome DevTools Protocol (CDP) WebSocket URL, for connecting your own Puppeteer or Playwright script to it. Starts a billed session that runs until the script closes the browser or it times out. For the agent itself to drive a browser, use tb_openBrowser instead. Pick valid `browserName` / `platform` values with getBrowsers.",
    {
      browserName: z.string().describe("Browser name (chrome, firefox, edge, safari)"),
      browserVersion: z
        .string()
        .optional()
        .default("latest")
        .describe("Browser version (default: 'latest')"),
      platform: z.string().describe("Platform/OS (WIN11, WIN10, MONTEREY, BIGSUR, etc.)"),
      screenResolution: z.string().optional().describe("Screen resolution (e.g., '1920x1080')"),
      timeZone: z.string().optional().describe("Time zone (e.g., 'America/New_York')"),
      name: z.string().optional().describe("Session name for identification"),
      build: z.string().optional().describe("Build identifier"),
      extraCapabilities: z
        .record(z.string(), z.any())
        .optional()
        .describe("Additional capabilities as key-value pairs"),
    },
    async (args: {
      browserName: string;
      browserVersion?: string;
      platform: string;
      screenResolution?: string;
      timeZone?: string;
      name?: string;
      build?: string;
      extraCapabilities?: Record<string, any>;
    }) => {
      try {
        logger.info({ browser: args.browserName, platform: args.platform }, "Creating CDP session");

        // Build capabilities object
        const capabilities: any = {
          browserName: args.browserName,
          browserVersion: args.browserVersion || "latest",
          platform: args.platform,
        };

        if (args.screenResolution) {
          capabilities.screenResolution = args.screenResolution;
        }
        if (args.timeZone) {
          capabilities.timeZone = args.timeZone;
        }
        if (args.name) {
          capabilities.name = args.name;
        }
        if (args.build) {
          capabilities.build = args.build;
        }

        // Merge extra capabilities
        if (args.extraCapabilities) {
          Object.assign(capabilities, args.extraCapabilities);
        }

        const options = { capabilities };
        const session = await testingBotApi.createSession(options);

        let formattedOutput = `## CDP Session Created\n\n`;
        formattedOutput += `- **Session ID**: ${session.session_id}\n`;
        formattedOutput += `- **CDP URL**: ${session.cdp_url}\n`;
        formattedOutput += `- **Browser**: ${args.browserName} ${args.browserVersion || "latest"}\n`;
        formattedOutput += `- **Platform**: ${args.platform}\n\n`;
        formattedOutput += `### Connect with Puppeteer\n\`\`\`javascript\n`;
        formattedOutput += `const puppeteer = require('puppeteer-core');\n`;
        formattedOutput += `const browser = await puppeteer.connect({\n`;
        formattedOutput += `  browserWSEndpoint: '${session.cdp_url}'\n`;
        formattedOutput += `});\n\`\`\`\n\n`;
        formattedOutput += `### Connect with Playwright\n\`\`\`javascript\n`;
        formattedOutput += `const { chromium } = require('playwright');\n`;
        formattedOutput += `const browser = await chromium.connectOverCDP('${session.cdp_url}');\n`;
        formattedOutput += `\`\`\`\n`;

        return {
          content: [
            {
              type: "text",
              text: formattedOutput,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("createCdpSession", error);
      }
    }
  );

  return tools;
}
