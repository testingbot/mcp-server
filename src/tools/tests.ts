import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError, sanitizeSessionId } from "../lib/utils.js";
import logger from "../lib/logger.js";

export default function addTestTools(server: any, testingBotApi: any, _config: TestingBotConfig) {
  const tools: Record<string, any> = {};
  const testStatus = function (statusId: number) {
    switch (statusId) {
      case 1:
        return "Passed";
      case 0:
        return "Failed";
      case 2:
        return "Unknown";
    }
  };

  const testUrl = function (test: any) {
    return `https://testingbot.com/members/tests/${test.session_id}`;
  };

  const formatBrowser = function (test: any): string {
    const name = typeof test.browser === "string" ? test.browser.trim() : "";
    const versionRaw = test.browser_version ?? test.version;
    const version = versionRaw == null ? "" : String(versionRaw).trim();
    return [name, version].filter(Boolean).join(" ");
  };

  tools.getTests = server.tool(
    "getTests",
    "List the account's most recent tests (newest first) with each test's session ID, name, status, browser, platform, video link and duration. Read-only. Start here to find a `sessionId` for getTestDetails, getFailureLogs, analyzeTestFailure, updateTest or deleteTest. For the tests of one CI build use getTestsForBuild. Paginate with `offset` / `limit` (default 10, max 100).",
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
        .describe("Number of tests to retrieve (default: 10, max: 100)"),
    },
    async (args: { offset?: number; limit?: number }) => {
      try {
        const offset = Number(args.offset ?? 0);
        const limit = Number(args.limit ?? 10);

        logger.info({ offset, limit }, "Fetching tests");

        const response = await testingBotApi.getTests(offset, limit);

        const tests = response?.data || [];
        const meta = response?.meta || {};

        logger.info(
          {
            count: tests.length,
            offset,
            limit,
            meta,
          },
          "Tests fetched successfully"
        );

        let formattedOutput = `## Recent Tests (showing ${limit} from offset ${offset})\n\n`;

        if (tests.length > 0) {
          tests.forEach((test: any) => {
            formattedOutput += `### Test ${test.session_id}\n`;

            if (test.name) {
              formattedOutput += `- **Name**: ${test.name}\n`;
            }

            // Status and success
            if (test.status_id !== undefined) {
              formattedOutput += `- **Status**: ${testStatus(test.status_id)}\n`;
            } else if (test.success !== undefined) {
              formattedOutput += `- **Success**: ${test.success ? "Yes" : "No"}\n`;
            }

            if (test.state) {
              formattedOutput += `- **State**: ${test.state}\n`;
            }

            // Browser and platform
            const browser = formatBrowser(test);
            if (browser) {
              formattedOutput += `- **Browser**: ${browser}\n`;
            }

            const platform = test.os || test.platform || test.platform_name;
            if (platform) {
              formattedOutput += `- **Platform**: ${platform}\n`;
            }

            // Timing
            if (test.duration) {
              formattedOutput += `- **Duration**: ${test.duration}s\n`;
            }
            if (test.created_at) {
              formattedOutput += `- **Created**: ${test.created_at}\n`;
            }
            if (test.completed_at) {
              formattedOutput += `- **Completed**: ${test.completed_at}\n`;
            }

            // Media
            if (test.video) {
              formattedOutput += `- **Video**: ${test.video}\n`;
            }

            // Build and extra
            if (test.build) {
              formattedOutput += `- **Build**: ${test.build}\n`;
            }
            if (test.extra) {
              formattedOutput += `- **Extra**: ${test.extra}\n`;
            }

            formattedOutput += `- **URL**: ${testUrl(test)}\n`;
            formattedOutput += "\n";
          });
        } else {
          formattedOutput += "No tests found.\n";
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
        logger.error(error);
        return handleMCPError("getTests", error);
      }
    }
  );

  tools.getTestDetails = server.tool(
    "getTestDetails",
    "Show everything recorded for one test: name, status and status message, browser, platform and device, duration, build, extra data, and links to the video, screenshots, log files and test page. Read-only. Get `sessionId` from getTests, getTestsForBuild or a tb_openBrowser session. To read the log contents use getFailureLogs; for an explanation of a failure use analyzeTestFailure.",
    {
      sessionId: z.string().describe("The session ID of the test"),
    },
    async (args: { sessionId: string }) => {
      try {
        const sessionId = sanitizeSessionId(args.sessionId);
        logger.info({ sessionId }, "Fetching test details");

        const test = await testingBotApi.getTestDetails(sessionId);

        let formattedOutput = `## Test Details: ${sessionId}\n\n`;

        if (test.name) {
          formattedOutput += `- **Name**: ${test.name}\n`;
        }

        // Status and success
        if (test.status_id !== undefined) {
          formattedOutput += `- **Status**: ${testStatus(test.status_id)}\n`;
        } else if (test.success !== undefined) {
          formattedOutput += `- **Success**: ${test.success ? "Yes" : "No"}\n`;
        }

        if (test.state) {
          formattedOutput += `- **State**: ${test.state}\n`;
        }

        if (test.status_message) {
          formattedOutput += `- **Status Message**: ${test.status_message}\n`;
        }

        // Browser and platform
        const browser = formatBrowser(test);
        if (browser) {
          formattedOutput += `- **Browser**: ${browser}\n`;
        }

        const platform = test.os || test.platform || test.platform_name;
        if (platform) {
          formattedOutput += `- **Platform**: ${platform}\n`;
        }

        if (test.device_name) {
          formattedOutput += `- **Device**: ${test.device_name}\n`;
        }

        // Test type and execution
        if (test.type) {
          formattedOutput += `- **Type**: ${test.type}\n`;
        }

        // Timing
        if (test.duration) {
          formattedOutput += `- **Duration**: ${test.duration}s\n`;
        }
        if (test.created_at) {
          formattedOutput += `- **Created**: ${test.created_at}\n`;
        }
        if (test.completed_at) {
          formattedOutput += `- **Completed**: ${test.completed_at}\n`;
        }

        // Media
        if (test.video) {
          formattedOutput += `- **Video**: ${test.video}\n`;
        }

        if (test.thumbs && Array.isArray(test.thumbs) && test.thumbs.length > 0) {
          formattedOutput += `- **Screenshots**: ${test.thumbs.length} available\n`;
        }

        // Logs
        if (test.logs && typeof test.logs === "object") {
          formattedOutput += `\n### Logs\n`;
          if (test.logs.selenium) {
            formattedOutput += `- **Selenium Log**: ${test.logs.selenium}\n`;
          }
          if (test.logs.browser) {
            formattedOutput += `- **Browser Log**: ${test.logs.browser}\n`;
          }
          if (test.logs.chrome) {
            formattedOutput += `- **Chrome Log**: ${test.logs.chrome}\n`;
          }
          if (test.logs.vm) {
            formattedOutput += `- **VM Log**: ${test.logs.vm}\n`;
          }
        }

        // Build and metadata
        if (test.build) {
          formattedOutput += `\n- **Build**: ${test.build}\n`;
        }
        if (test.extra) {
          formattedOutput += `- **Extra**: ${test.extra}\n`;
        }

        // Test steps
        if (test.steps && Array.isArray(test.steps) && test.steps.length > 0) {
          formattedOutput += `\n### Test Steps (${test.steps.length} steps)\n`;
          test.steps.forEach((step: any, index: number) => {
            formattedOutput += `\n**Step ${index + 1}**: ${step.command}\n`;
            if (step.arguments) {
              formattedOutput += `- Arguments: ${step.arguments}\n`;
            }
            if (step.response) {
              const responseText = step.response.substring(0, 100);
              formattedOutput += `- Response: ${responseText}${step.response.length > 100 ? "..." : ""}\n`;
            }
            if (step.time) {
              formattedOutput += `- Time: ${new Date(step.time).toISOString()}\n`;
            }
          });
        }

        formattedOutput += `\n- **Test URL**: ${testUrl(test)}\n`;

        if (test.assets_available) {
          formattedOutput += `- **Assets**: Available\n`;
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
        return handleMCPError("getTestDetails", error);
      }
    }
  );

  tools.updateTest = server.tool(
    "updateTest",
    "Change a test's metadata on TestingBot: its name, pass/fail status, build, or extra data (a JSON string). Only the fields you pass are changed. Use it to report a test's outcome after it ran, since TestingBot can't tell whether the assertions passed, or to group it into a build. Get `sessionId` from getTests or tb_openBrowser.",
    {
      sessionId: z.string().describe("The session ID of the test to update"),
      name: z.string().optional().describe("New name for the test"),
      status: z.enum(["passed", "failed"]).optional().describe("Mark test as passed or failed"),
      build: z.string().optional().describe("Build identifier"),
      extra: z.string().optional().describe("Additional metadata (JSON string)"),
    },
    async (args: {
      sessionId: string;
      name?: string;
      status?: string;
      build?: string;
      extra?: string;
    }) => {
      try {
        const sessionId = sanitizeSessionId(args.sessionId);
        logger.info({ sessionId, updates: args }, "Updating test");

        const updateData: any = {};
        if (args.name) updateData.name = args.name;
        if (args.status) updateData["test[success]"] = args.status === "passed" ? "1" : "0";
        if (args.build) updateData.build = args.build;
        if (args.extra) updateData.extra = args.extra;

        await testingBotApi.updateTest(updateData, sessionId);

        return {
          content: [
            {
              type: "text",
              text: `Test ${sessionId} updated successfully.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("updateTest", error);
      }
    }
  );

  tools.deleteTest = server.tool(
    "deleteTest",
    "Permanently delete one test and its video, logs and screenshots. This cannot be undone; only call it when the user asked to delete that test. Get `sessionId` from getTests. To end a test that is still running without deleting it use stopTest; to delete a whole build use deleteBuild. Returns a confirmation, or an error if no test has that ID.",
    {
      sessionId: z.string().describe("The session ID of the test to delete"),
    },
    async (args: { sessionId: string }) => {
      try {
        const sessionId = sanitizeSessionId(args.sessionId);
        logger.info({ sessionId }, "Deleting test");

        await testingBotApi.deleteTest(sessionId);

        return {
          content: [
            {
              type: "text",
              text: `Test ${sessionId} deleted successfully.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("deleteTest", error);
      }
    }
  );

  tools.stopTest = server.tool(
    "stopTest",
    "End a test that is still running, immediately, as if the client had quit; the test is kept with its video and logs up to that point. Use it to stop a stuck or runaway session that is using minutes. Get `sessionId` from getTests (running tests) or tb_listSessions. To end a session this server opened, prefer tb_closeBrowser. Returns a confirmation.",
    {
      sessionId: z.string().describe("The session ID of the test to stop"),
    },
    async (args: { sessionId: string }) => {
      try {
        const sessionId = sanitizeSessionId(args.sessionId);
        logger.info({ sessionId }, "Stopping test");

        await testingBotApi.stopTest(sessionId);

        return {
          content: [
            {
              type: "text",
              text: `Test ${sessionId} stopped successfully.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("stopTest", error);
      }
    }
  );

  return tools;
}
