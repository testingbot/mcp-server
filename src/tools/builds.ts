import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

export default function addBuildTools(server: any, testingBotApi: any, _config: TestingBotConfig) {
  const tools: Record<string, any> = {};

  tools.getBuilds = server.tool(
    "getBuilds",
    "List the account's builds (groups of tests that share a build name), newest first, with each build's name, ID, number of tests and creation date. Read-only. Use it to find a `buildId` for getTestsForBuild or deleteBuild. To list individual tests regardless of build, use getTests. Paginate with `offset` / `limit` (default 10, max 100).",
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
    "List every test in one build, with each test's session ID, status, browser, platform and duration. Read-only. Get `buildId` from getBuilds. Use it to review a CI run as a whole, e.g. to find the failed tests; then open a single test with getTestDetails, getFailureLogs or analyzeTestFailure.",
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
    "Permanently delete a build and every test in it, including their videos, logs and screenshots. This cannot be undone; only call it when the user asked to delete that build. Get `buildId` from getBuilds and confirm it with getTestsForBuild first. To remove a single test use deleteTest instead. Returns a confirmation, or an error if the build does not exist.",
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
