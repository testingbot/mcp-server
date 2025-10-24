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

  tools.getTests = server.tool(
    "getTests",
    "Retrieve a list of recent tests with optional pagination. Returns test details including status, browser, platform, video and duration.",
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
            const browser =
              test.browser || test.browser_version
                ? `${test.browser || ""}${test.browser_version || test.version || ""}`.trim()
                : test.browser || "";
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
    "Get detailed information about a specific test by session ID. Includes logs, screenshots, video URLs, and execution metadata.",
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
        const browser =
          test.browser || test.browser_version
            ? `${test.browser || ""}${test.browser_version || test.version || ""}`.trim()
            : test.browser || "";
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
    "Update test metadata such as name, status (passed/failed), and other attributes. Useful for marking tests after execution.",
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
    "Delete a test by session ID. This permanently removes the test and its associated data.",
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
    "Stop a running test by session ID. This terminates the test execution immediately.",
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
