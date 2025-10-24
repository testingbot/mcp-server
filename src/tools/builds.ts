import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

export default function addBuildTools(server: any, testingBotApi: any, _config: TestingBotConfig) {
  const tools: Record<string, any> = {};

  tools.getBuilds = server.tool(
    "getBuilds",
    "Get a list of builds with optional pagination. Builds group related tests together.",
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
        .describe("Number of builds to retrieve (default: 10, max: 100)"),
    },
    async (args: { offset?: number; limit?: number }) => {
      try {
        const offset = Number(args.offset ?? 0);
        const limit = Number(args.limit ?? 10);

        logger.info({ offset, limit }, "Fetching builds");

        const response = await testingBotApi.getBuilds(offset, limit);
        const builds = response?.data || [];

        let formattedOutput = `## Recent Builds (showing ${limit} from offset ${offset})\n\n`;

        if (builds.length > 0) {
          builds.forEach((build: any) => {
            formattedOutput += `### Build: ${build.name || build.id}\n`;
            formattedOutput += `- **ID**: ${build.id}\n`;
            formattedOutput += `- **Tests**: ${build.tests || 0}\n`;
            formattedOutput += `- **Created**: ${build.created_at}\n`;
            formattedOutput += "\n";
          });
        } else {
          formattedOutput += "No builds found.\n";
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
        return handleMCPError("getBuilds", error);
      }
    }
  );

  tools.getTestsForBuild = server.tool(
    "getTestsForBuild",
    "Get all tests associated with a specific build ID.",
    {
      buildId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number())
        .describe("The build ID"),
    },
    async (args: { buildId: number }) => {
      try {
        const buildId = Number(args.buildId);

        logger.info({ buildId }, "Fetching tests for build");

        const response = await testingBotApi.getTestsForBuild(buildId);
        const tests = response?.data || [];

        let formattedOutput = `## Tests for Build ${buildId}\n\n`;

        if (tests.length > 0) {
          tests.forEach((test: any) => {
            formattedOutput += `### Test ${test.session_id}\n`;
            formattedOutput += `- **Status**: ${test.status}\n`;
            formattedOutput += `- **Browser**: ${test.browser} ${test.version}\n`;
            formattedOutput += `- **Platform**: ${test.platform}\n`;
            formattedOutput += `- **Duration**: ${test.duration}s\n`;
            formattedOutput += "\n";
          });
        } else {
          formattedOutput += "No tests found for this build.\n";
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
        return handleMCPError("getTestsForBuild", error);
      }
    }
  );

  tools.deleteBuild = server.tool(
    "deleteBuild",
    "Delete a build and all its associated tests by build ID.",
    {
      buildId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number())
        .describe("The build ID to delete"),
    },
    async (args: { buildId: number }) => {
      try {
        const buildId = Number(args.buildId);

        logger.info({ buildId }, "Deleting build");

        await testingBotApi.deleteBuild(buildId);

        return {
          content: [
            {
              type: "text",
              text: `Build ${buildId} deleted successfully.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("deleteBuild", error);
      }
    }
  );

  return tools;
}
