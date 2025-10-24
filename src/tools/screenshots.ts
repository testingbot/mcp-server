import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError, validateUrl } from "../lib/utils.js";
import logger from "../lib/logger.js";

export default function addScreenshotTools(
  server: any,
  testingBotApi: any,
  _config: TestingBotConfig
) {
  const tools: Record<string, any> = {};

  tools.takeScreenshot = server.tool(
    "takeScreenshot",
    "Take screenshots of a URL across multiple browsers and platforms. Returns a screenshot ID to retrieve results.",
    {
      url: z.string().url().describe("The URL to screenshot"),
      browsers: z
        .array(
          z.object({
            browserName: z.string().describe("Browser name (chrome, firefox, safari, etc.)"),
            version: z.string().optional().describe("Browser version (or 'latest')"),
            os: z.string().describe("Operating system (WIN11, MAC, etc.)"),
          })
        )
        .describe("Array of browser configurations"),
      resolution: z
        .string()
        .optional()
        .default("1920x1080")
        .describe("Screen resolution (e.g., '1920x1080')"),
      waitTime: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().min(0).max(60))
        .optional()
        .default(5)
        .describe("Time to wait before taking screenshot (in seconds, max 60)"),
      fullPage: z
        .union([z.boolean(), z.string().transform((s) => s === "true")])
        .pipe(z.boolean())
        .optional()
        .default(false)
        .describe("Capture full page or just viewport"),
    },
    async (args: {
      url: string;
      browsers: Array<{ browserName: string; version?: string; os: string }>;
      resolution?: string;
      waitTime?: number;
      fullPage?: boolean;
    }) => {
      try {
        if (!validateUrl(args.url)) {
          throw new Error("Invalid URL provided");
        }

        logger.info({ url: args.url, browsers: args.browsers.length }, "Taking screenshots");

        const result = await testingBotApi.takeScreenshot(
          args.url,
          args.browsers,
          args.resolution,
          args.waitTime,
          args.fullPage
        );

        return {
          content: [
            {
              type: "text",
              text: `Screenshot job created successfully!\n\n**Screenshot ID**: ${result.id}\n\nUse the \`retrieveScreenshots\` tool with this ID to get the results once processing is complete.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("takeScreenshot", error);
      }
    }
  );

  tools.retrieveScreenshots = server.tool(
    "retrieveScreenshots",
    "Retrieve screenshot results by screenshot ID. Returns URLs to the generated screenshots.",
    {
      screenshotId: z.string().describe("The screenshot ID from takeScreenshot"),
    },
    async (args: { screenshotId: string }) => {
      try {
        logger.info({ screenshotId: args.screenshotId }, "Retrieving screenshots");

        const result = await testingBotApi.retrieveScreenshots(args.screenshotId);

        let formattedOutput = `## Screenshots for ${result.url}\n\n`;
        formattedOutput += `**Status**: ${result.state || "processing"}\n\n`;

        if (result.screenshots && Array.isArray(result.screenshots)) {
          result.screenshots.forEach((screenshot: any) => {
            formattedOutput += `### ${screenshot.browser} ${screenshot.version} on ${screenshot.os}\n`;
            formattedOutput += `- **Screenshot**: ${screenshot.image_url}\n`;
            formattedOutput += `- **Thumbnail**: ${screenshot.thumb_url}\n`;
            formattedOutput += "\n";
          });
        } else {
          formattedOutput += "Screenshots are still processing. Please try again in a moment.\n";
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
        return handleMCPError("retrieveScreenshots", error);
      }
    }
  );

  tools.getScreenshotList = server.tool(
    "getScreenshotList",
    "Get a list of all screenshot jobs with pagination.",
    {
      offset: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().min(0))
        .optional()
        .default(0)
        .describe("Offset for pagination (default: 0)"),
      limit: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().min(1).max(100))
        .optional()
        .default(10)
        .describe("Number of screenshot jobs to retrieve (default: 10, max: 100)"),
    },
    async (args: { offset?: number; limit?: number }) => {
      try {
        const offset = Number(args.offset ?? 0);
        const limit = Number(args.limit ?? 10);

        logger.info({ offset, limit }, "Fetching screenshot list");

        const response = await testingBotApi.getScreenshotList(offset, limit);
        const screenshots = response?.data || [];

        let formattedOutput = `## Screenshot Jobs (showing ${limit} from offset ${offset})\n\n`;

        if (screenshots.length > 0) {
          screenshots.forEach((screenshot: any) => {
            formattedOutput += `### ${screenshot.url}\n`;
            formattedOutput += `- **ID**: ${screenshot.id}\n`;
            formattedOutput += `- **Status**: ${screenshot.state || "processing"}\n`;
            formattedOutput += `- **Created**: ${screenshot.created_at}\n`;
            formattedOutput += "\n";
          });
        } else {
          formattedOutput += "No screenshot jobs found.\n";
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
        return handleMCPError("getScreenshotList", error);
      }
    }
  );

  return tools;
}
