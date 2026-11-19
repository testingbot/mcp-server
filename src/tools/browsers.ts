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
    'List the browsers, versions and platforms (and mobile emulators/simulators, with their browser ID) that TestingBot can run automated tests on. Read-only. Use it to pick valid `browserName` / `platform` / `version` values for tb_openBrowser, createCdpSession or takeScreenshot. `type: "web"` returns desktop browsers only, `"mobile"` only emulators and simulators. Physical devices are listed by getDevices.',
    {
      type: z.enum(["web", "mobile"]).optional().describe("Filter browsers by type"),
    },
    async (args: { type?: "web" | "mobile" }) => {
      try {
        logger.info({ type: args.type }, "Fetching browsers");

        // The API's own `type` parameter is the automation protocol
        // (webdriver / rc), not web vs mobile, and rejects these values. Fetch
        // the WebDriver catalog and filter here: mobile entries name a device.
        const catalog = await testingBotApi.getBrowsers();
        const browsers =
          Array.isArray(catalog) && args.type
            ? catalog.filter((b: any) => Boolean(b.deviceName) === (args.type === "mobile"))
            : catalog;

        let formattedOutput = "## Available Browsers\n\n";

        if (Array.isArray(browsers)) {
          browsers.forEach((browser: any) => {
            formattedOutput += `### ${browser.name || browser.browserName}\n`;
            formattedOutput += `- **Platform**: ${browser.platform || browser.os}\n`;
            formattedOutput += `- **Version**: ${browser.version || browser.browserVersion}\n`;
            const device = browser.deviceName || browser.device;
            if (device) {
              formattedOutput += `- **Device**: ${device}\n`;
            }
            if (browser.browser_id) {
              formattedOutput += `- **Browser ID**: ${browser.browser_id}\n`;
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
    "List TestingBot's physical (real) mobile devices with their ID, name, platform, OS version and whether each is available right now. Read-only. Use it before requesting a real device (e.g. `realDevice: true` in tb_openBrowser or runMaestroTest) to choose a device that exists and is free. Emulators and simulators are listed by getBrowsers.",
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
            // The /v1/devices endpoint returns `platform_name` (not `platform`).
            formattedOutput += `- **Platform**: ${device.platform_name || device.platform}\n`;
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
