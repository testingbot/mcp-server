import { z } from "zod";
import path from "path";
import fs from "fs";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import {
  AppAutomateClient,
  AppAutomateFramework,
  FrameworkCapabilities,
  FrameworkRunInfo,
} from "../lib/app-automate-client.js";
import logger from "../lib/logger.js";

// Allowed uploads per framework. Espresso tests are an instrumented test APK;
// XCUITest tests are a zipped .xctestrun bundle.
const APP_EXTENSIONS: Record<AppAutomateFramework, Set<string>> = {
  espresso: new Set([".apk", ".aab"]),
  xcuitest: new Set([".ipa", ".zip"]),
};
const TEST_EXTENSIONS: Record<AppAutomateFramework, Set<string>> = {
  espresso: new Set([".apk"]),
  xcuitest: new Set([".zip"]),
};

const frameworkSchema = z.enum(["espresso", "xcuitest"]).describe("Test framework");
const projectIdSchema = z
  .union([z.number(), z.string().transform(Number)])
  .pipe(z.number().int().positive());

function validateUploadPath(input: string, allowed: Set<string>): string {
  const resolved = path.resolve(input);
  const ext = path.extname(resolved).toLowerCase();
  if (!allowed.has(ext)) {
    throw new Error(
      `Only ${[...allowed].join(", ")} files may be uploaded here (got "${ext || "no extension"}")`
    );
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`File not found or not readable: ${resolved}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Path is not a regular file: ${resolved}`);
  }
  return resolved;
}

function formatFrameworkRun(run: FrameworkRunInfo): string {
  let out = `### Run ${run.id} — ${run.status}${run.success ? " ✅" : run.status === "DONE" || run.status === "FAILED" ? " ❌" : ""}\n`;
  const env = run.test?.environment;
  const caps = run.capabilities as { deviceName?: string; version?: string } | undefined;
  const device = env?.name || caps?.deviceName || "unknown device";
  const version = env?.version || caps?.version;
  out += `- **Device**: ${device}${version ? ` (${version})` : ""}\n`;
  if (run.test?.sessionId) {
    out += `- **Session ID**: ${run.test.sessionId} (use getTestDetails / getFailureLogs for logs and video)\n`;
  }
  return out;
}

export default function addAppAutomateTools(
  server: any,
  _testingBotApi: any,
  config: TestingBotConfig
) {
  const tools: Record<string, any> = {};
  // Lazily constructed so tb_login (which mutates config) is picked up.
  const client = () => new AppAutomateClient(config);

  tools.uploadAppAutomateApp = server.tool(
    "uploadAppAutomateApp",
    "Upload the app under test for an Espresso (.apk/.aab) or XCUITest (.ipa) run on TestingBot. Returns a projectId for uploadAppAutomateTests and runAppAutomateTest. For Maestro flows use uploadMaestroApp instead.",
    {
      framework: frameworkSchema,
      localFilePath: z.string().describe("Local path to the app file"),
    },
    async (args: { framework: AppAutomateFramework; localFilePath: string }) => {
      try {
        const safePath = validateUploadPath(args.localFilePath, APP_EXTENSIONS[args.framework]);
        logger.info({ framework: args.framework, path: safePath }, "Uploading app");

        const result = await client().uploadFrameworkApp(args.framework, safePath);
        return {
          content: [
            {
              type: "text",
              text: `App uploaded successfully!\n\n**Project ID**: ${result.id}\n\nNext: upload the test suite with uploadAppAutomateTests, then start with runAppAutomateTest.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("uploadAppAutomateApp", error);
      }
    }
  );

  tools.uploadAppAutomateTests = server.tool(
    "uploadAppAutomateTests",
    "Upload the test suite for an App Automate project: the instrumented test APK for Espresso, or the zipped XCUITest runner bundle for XCUITest.",
    {
      framework: frameworkSchema,
      projectId: projectIdSchema.describe("Project ID returned by uploadAppAutomateApp"),
      localFilePath: z
        .string()
        .describe("Local path to the test suite (.apk for Espresso, .zip for XCUITest)"),
    },
    async (args: { framework: AppAutomateFramework; projectId: number; localFilePath: string }) => {
      try {
        const safePath = validateUploadPath(args.localFilePath, TEST_EXTENSIONS[args.framework]);
        logger.info(
          { framework: args.framework, projectId: args.projectId, path: safePath },
          "Uploading test suite"
        );

        await client().uploadFrameworkTests(args.framework, Number(args.projectId), safePath);
        return {
          content: [
            {
              type: "text",
              text: `Test suite uploaded for ${args.framework} project ${args.projectId}.\n\nNext: start the run with runAppAutomateTest.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("uploadAppAutomateTests", error);
      }
    }
  );

  tools.runAppAutomateTest = server.tool(
    "runAppAutomateTest",
    "Start an Espresso or XCUITest run on a TestingBot device. Returns immediately with the run ID — it does NOT wait for completion. Poll with getAppAutomateRunStatus, then fetch getAppAutomateRunResults.",
    {
      framework: frameworkSchema,
      projectId: projectIdSchema.describe("Project ID returned by uploadAppAutomateApp"),
      deviceName: z
        .string()
        .optional()
        .describe(
          'Device name, supports wildcards/regex (e.g. "Pixel 8", "iPhone 1[4-6]", "*"). Default: any device'
        ),
      version: z.string().optional().describe('OS version (e.g. "14")'),
      realDevice: z
        .boolean()
        .optional()
        .default(false)
        .describe("Run on a physical device instead of an emulator/simulator"),
      name: z.string().optional().describe("A name for this test run, shown in the dashboard"),
      build: z.string().optional().describe("Build identifier to group runs"),
      testClasses: z
        .array(z.string())
        .optional()
        .describe("Espresso only: run only these test classes (fully qualified)"),
      skipTestClasses: z
        .array(z.string())
        .optional()
        .describe("Espresso only: skip these test classes"),
      packages: z.array(z.string()).optional().describe("Espresso only: run only these packages"),
      annotations: z
        .array(z.string())
        .optional()
        .describe("Espresso only: run only tests with these annotations"),
      testRunner: z.string().optional().describe("Espresso only: custom instrumentation runner"),
      locale: z.string().optional().describe('Locale for the run (e.g. "fr_FR")'),
      timeZone: z.string().optional().describe('Time zone for the run (e.g. "Europe/Brussels")'),
    },
    async (args: {
      framework: AppAutomateFramework;
      projectId: number;
      deviceName?: string;
      version?: string;
      realDevice?: boolean;
      name?: string;
      build?: string;
      testClasses?: string[];
      skipTestClasses?: string[];
      packages?: string[];
      annotations?: string[];
      testRunner?: string;
      locale?: string;
      timeZone?: string;
    }) => {
      try {
        const projectId = Number(args.projectId);
        const capabilities: FrameworkCapabilities = {
          deviceName: args.deviceName || "*",
          platformName: args.framework === "espresso" ? "Android" : "iOS",
        };
        if (args.version) capabilities.version = args.version;
        if (args.name) capabilities.name = args.name;
        if (args.build) capabilities.build = args.build;
        if (args.realDevice) capabilities.realDevice = "true";

        const options: Record<string, unknown> = {};
        if (args.framework === "espresso") {
          if (args.testRunner) options.testRunner = args.testRunner;
          if (args.testClasses?.length) options.class = args.testClasses;
          if (args.skipTestClasses?.length) options.notClass = args.skipTestClasses;
          if (args.packages?.length) options.package = args.packages;
          if (args.annotations?.length) options.annotation = args.annotations;
        }
        if (args.locale) options.locale = args.locale;
        if (args.timeZone) options.timeZone = args.timeZone;

        logger.info({ framework: args.framework, projectId, capabilities }, "Starting run");
        const started = await client().startFrameworkRun(
          args.framework,
          projectId,
          capabilities,
          options
        );

        const runList = (started.runs || []).map((run) => `- Run **${run.id}**`).join("\n");
        return {
          content: [
            {
              type: "text",
              text:
                `${args.framework} run started on project ${projectId} (running asynchronously).\n\n${runList}\n\n` +
                `Poll progress with getAppAutomateRunStatus (every 10-15 seconds), then fetch getAppAutomateRunResults when completed.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("runAppAutomateTest", error);
      }
    }
  );

  tools.getAppAutomateRunStatus = server.tool(
    "getAppAutomateRunStatus",
    "Get the status of Espresso/XCUITest run(s) for a project. Omit runId to list all runs. Statuses: WAITING, READY (running), DONE, FAILED.",
    {
      framework: frameworkSchema,
      projectId: projectIdSchema.describe("Project ID"),
      runId: projectIdSchema.optional().describe("Specific run ID to inspect"),
    },
    async (args: { framework: AppAutomateFramework; projectId: number; runId?: number }) => {
      try {
        const projectId = Number(args.projectId);
        if (args.runId) {
          const run = await client().getFrameworkRun(args.framework, projectId, Number(args.runId));
          return {
            content: [
              {
                type: "text",
                text: `## ${args.framework} Run Status (project ${projectId})\n\n${formatFrameworkRun(run)}`,
              },
            ],
          };
        }

        const status = await client().getFrameworkProject(args.framework, projectId);
        let out = `## ${args.framework} Runs (project ${projectId}) — ${status.completed ? "completed" : "in progress"}\n\n`;
        for (const run of status.runs || []) {
          out += formatFrameworkRun(run) + "\n";
        }
        if (status.completed) {
          out += "\nAll runs finished — fetch getAppAutomateRunResults for the JUnit report.";
        }
        return { content: [{ type: "text", text: out }] };
      } catch (error) {
        return handleMCPError("getAppAutomateRunStatus", error);
      }
    }
  );

  tools.getAppAutomateRunResults = server.tool(
    "getAppAutomateRunResults",
    "Get the results of a completed Espresso/XCUITest project: per-run outcomes plus the JUnit XML report. For XCUITest, pass runId for a single run's report.",
    {
      framework: frameworkSchema,
      projectId: projectIdSchema.describe("Project ID"),
      runId: projectIdSchema
        .optional()
        .describe("XCUITest only: fetch the JUnit report of this single run"),
    },
    async (args: { framework: AppAutomateFramework; projectId: number; runId?: number }) => {
      try {
        const projectId = Number(args.projectId);
        const status = await client().getFrameworkProject(args.framework, projectId);

        let junit = "";
        try {
          junit =
            args.framework === "xcuitest" && args.runId
              ? await client().getXcuitestRunJunitReport(projectId, Number(args.runId))
              : await client().getFrameworkProjectReport(args.framework, projectId);
        } catch {
          junit = "(JUnit report not available yet)";
        }

        const outcome = !status.completed
          ? "STILL RUNNING"
          : status.success
            ? "PASSED ✅"
            : "FAILED ❌";
        let text = `## ${args.framework} Results (project ${projectId}) — ${outcome}\n\n`;
        for (const run of status.runs || []) {
          text += formatFrameworkRun(run) + "\n";
        }
        text += `### JUnit Report\n\n\`\`\`xml\n${junit}\n\`\`\``;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return handleMCPError("getAppAutomateRunResults", error);
      }
    }
  );

  return tools;
}
