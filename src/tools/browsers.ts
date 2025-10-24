import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

export default function addBrowserTools(
  server: any,
  testingBotApi: any,
  _config: TestingBotConfig
) {
  const tools: Record<string, any> = {};

  tools.getBrowsers = server.tool(
    "getBrowsers",
    "Get list of available browsers and platforms for testing. Optionally filter by type (web or mobile).",
    {
      type: z.enum(["web", "mobile"]).optional().describe("Filter browsers by type"),
    },
    async (args: { type?: "web" | "mobile" }) => {
      try {
        logger.info({ type: args.type }, "Fetching browsers");

        const browsers = await testingBotApi.getBrowsers(args.type);

        let formattedOutput = "## Available Browsers\n\n";

        if (Array.isArray(browsers)) {
          browsers.forEach((browser: any) => {
            formattedOutput += `### ${browser.name || browser.browserName}\n`;
            formattedOutput += `- **Platform**: ${browser.platform || browser.os}\n`;
            formattedOutput += `- **Version**: ${browser.version || browser.browserVersion}\n`;
            if (browser.device) {
              formattedOutput += `- **Device**: ${browser.device}\n`;
            }
            formattedOutput += "\n";
          });
        } else {
          formattedOutput = JSON.stringify(browsers, null, 2);
        }

        return {
          content: [
            {
              type: "text",
              text: formattedOutput,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("getBrowsers", error);
      }
    }
  );

  tools.getDevices = server.tool(
    "getDevices",
    "Get list of available mobile devices for testing (real devices and simulators).",
    {},
    async () => {
      try {
        logger.info("Fetching devices");

        const devices = await testingBotApi.getDevices();

        let formattedOutput = "## Available Devices\n\n";

        if (Array.isArray(devices)) {
          devices.forEach((device: any) => {
            formattedOutput += `### ${device.name}\n`;
            formattedOutput += `- **ID**: ${device.id}\n`;
            formattedOutput += `- **Platform**: ${device.platform}\n`;
            formattedOutput += `- **Version**: ${device.version}\n`;
            formattedOutput += `- **Available**: ${device.available ? "Yes" : "No"}\n`;
            formattedOutput += "\n";
          });
        } else {
          formattedOutput = JSON.stringify(devices, null, 2);
        }

        return {
          content: [
            {
              type: "text",
              text: formattedOutput,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("getDevices", error);
      }
    }
  );

  return tools;
}
