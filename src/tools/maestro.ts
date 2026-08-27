import { z } from "zod";
import path from "path";
import fs from "fs";
import { zipSync } from "fflate";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import {
  AppAutomateClient,
  MaestroCapabilities,
  MaestroRunInfo,
  MaestroRunOptions,
} from "../lib/app-automate-client.js";
import logger from "../lib/logger.js";

const ALLOWED_APP_EXTENSIONS = new Set([".apk", ".aab", ".ipa", ".zip"]);

function validateAppPath(input: string): string {
  const resolved = path.resolve(input);
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_APP_EXTENSIONS.has(ext)) {
    throw new Error(
      `Only ${[...ALLOWED_APP_EXTENSIONS].join(", ")} files may be uploaded (got "${ext || "no extension"}")`
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

// Collect all .yaml/.yml files under a directory (recursively), preserving
// relative paths so runFlow/runScript references between flows keep working.
function collectYamlFiles(dir: string, baseDir: string, out: Record<string, Uint8Array>) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectYamlFiles(full, baseDir, out);
    } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
      out[path.relative(baseDir, full).split(path.sep).join("/")] = fs.readFileSync(full);
    }
  }
}

function buildFlowsZip(args: {
  flowsPath?: string;
  flows?: Array<{ fileName: string; content: string }>;
}): Buffer {
  if (args.flows && args.flows.length > 0) {
    const files: Record<string, Uint8Array> = {};
    for (const flow of args.flows) {
      const name = flow.fileName.replace(/\\/g, "/").replace(/^\/+/, "");
      if (name.includes("..") || !/\.ya?ml$/i.test(name)) {
        throw new Error(
          `Invalid flow file name "${flow.fileName}" — must be a relative .yaml/.yml path`
        );
      }
      files[name] = new TextEncoder().encode(flow.content);
    }
    return Buffer.from(zipSync(files));
  }

  if (!args.flowsPath) {
    throw new Error("Provide either flowsPath (a directory or .zip) or inline flows");
  }
  const resolved = path.resolve(args.flowsPath);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    if (path.extname(resolved).toLowerCase() !== ".zip") {
      throw new Error("flowsPath must be a directory of YAML flows or a .zip file");
    }
    return fs.readFileSync(resolved);
  }
  const files: Record<string, Uint8Array> = {};
  collectYamlFiles(resolved, resolved, files);
  if (Object.keys(files).length === 0) {
    throw new Error(`No .yaml/.yml flow files found in ${resolved}`);
  }
  return Buffer.from(zipSync(files));
}

function formatRun(run: MaestroRunInfo): string {
  let out = `### Run ${run.id} — ${run.status}\n`;
  const env = run.environment;
  const caps = run.capabilities;
  const device = env?.device || caps?.deviceName || "unknown device";
  const version = env?.version || caps?.version || "";
  out += `- **Device**: ${device}${version ? ` (${caps?.platformName || ""} ${version})` : ""}\n`;
  if (run.error_messages && run.error_messages.length > 0) {
    out += `- **Errors**: ${run.error_messages.join("; ")}\n`;
  }
  const flows = run.flows || [];
  if (flows.length > 0) {
    // Failures first so agents see what needs attention without scrolling.
    const sorted = [...flows].sort(
      (a, b) => Number(a.status !== "FAILED") - Number(b.status !== "FAILED")
    );
    out += `- **Flows** (${flows.length}):\n`;
    for (const flow of sorted) {
      out += `  - ${flow.name} [id ${flow.id}]: ${flow.status}`;
      if (flow.error_messages && flow.error_messages.length > 0) {
        out += ` — ${flow.error_messages.join("; ")}`;
      }
      if (flow.status === "FAILED" && flow.assets?.video) {
        out += ` (video: ${flow.assets.video})`;
      }
      out += "\n";
    }
  }
  return out;
}

export default function addMaestroTools(
  server: any,
  _testingBotApi: any,
  config: TestingBotConfig
) {
  const tools: Record<string, any> = {};
  // Lazily constructed so tb_login (which mutates config) is picked up.
  const client = () => new AppAutomateClient(config);

  tools.uploadMaestroApp = server.tool(
    "uploadMaestroApp",
    "Upload a mobile app (APK, AAB, IPA, or zipped .app) for Maestro testing on TestingBot. Skips the upload if the same binary was uploaded before. Returns a projectId used by uploadMaestroFlows and runMaestroTest.",
    {
      localFilePath: z.string().describe("Local path to the .apk, .aab, .ipa or .zip app file"),
    },
    async (args: { localFilePath: string }) => {
      try {
        const safePath = validateAppPath(args.localFilePath);
        logger.info({ path: safePath }, "Uploading Maestro app");

        const checksum = await AppAutomateClient.md5Checksum(safePath);
        const existingId = await client().findAppByChecksum(checksum);
        if (existingId) {
          return {
            content: [
              {
                type: "text",
                text: `App already uploaded — reusing it.\n\n**Project ID**: ${existingId}\n\nNext: upload flows with uploadMaestroFlows, then start a run with runMaestroTest.`,
              },
            ],
          };
        }

        const result = await client().uploadApp(safePath);
        return {
          content: [
            {
              type: "text",
              text: `App uploaded successfully!\n\n**Project ID**: ${result.id}\n\nNext: upload flows with uploadMaestroFlows, then start a run with runMaestroTest.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("uploadMaestroApp", error);
      }
    }
  );

  tools.uploadMaestroFlows = server.tool(
    "uploadMaestroFlows",
    "Upload Maestro flow YAML files for a project. Accepts a local directory (all .yaml/.yml files, preserving structure), a pre-built .zip, or inline flow content. Replaces any previously uploaded flows for the project.",
    {
      projectId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .describe("Project ID returned by uploadMaestroApp"),
      flowsPath: z
        .string()
        .optional()
        .describe("Local path to a directory containing flow YAML files, or to a .zip of flows"),
      flows: z
        .array(
          z.object({
            fileName: z
              .string()
              .describe("Relative file name, e.g. login.yaml or flows/checkout.yaml"),
            content: z.string().describe("The Maestro flow YAML content"),
          })
        )
        .optional()
        .describe("Inline flow files to upload instead of flowsPath"),
    },
    async (args: {
      projectId: number;
      flowsPath?: string;
      flows?: Array<{ fileName: string; content: string }>;
    }) => {
      try {
        const zipBuffer = buildFlowsZip(args);
        logger.info(
          { projectId: args.projectId, bytes: zipBuffer.length },
          "Uploading Maestro flows"
        );

        await client().uploadFlowsZip(Number(args.projectId), zipBuffer, "flows.zip");
        return {
          content: [
            {
              type: "text",
              text: `Flows uploaded successfully for project ${args.projectId}.\n\nNext: start a run with runMaestroTest.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("uploadMaestroFlows", error);
      }
    }
  );

  tools.runMaestroTest = server.tool(
    "runMaestroTest",
    "Start a Maestro test run on a TestingBot device. Returns immediately with the run ID — it does NOT wait for completion. Poll with getMaestroRunStatus, then fetch getMaestroRunResults once completed.",
    {
      projectId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .describe("Project ID returned by uploadMaestroApp"),
      platformName: z.enum(["Android", "iOS"]).describe("Mobile platform to run on"),
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
        .describe(
          "Run on a physical device instead of an emulator/simulator (required for .ipa apps)"
        ),
      name: z
        .string()
        .optional()
        .describe("A name for this test run, shown in the TestingBot dashboard"),
      env: z
        .record(z.string())
        .optional()
        .describe("Environment variables passed to the Maestro flows"),
      includeTags: z
        .array(z.string())
        .optional()
        .describe("Only run flows with these Maestro tags"),
      excludeTags: z.array(z.string()).optional().describe("Skip flows with these Maestro tags"),
      shardSplit: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().min(1).max(10))
        .optional()
        .describe("Split flows across this many parallel devices"),
      otherApps: z
        .array(z.string().regex(/^(tb|https?):\/\//, "Must be a tb:// or http(s):// URL"))
        .max(4)
        .optional()
        .describe(
          "Up to 4 companion app URLs (tb:// from uploadMaestroCompanionApp, or http(s)://) installed alongside the app under test"
        ),
    },
    async (args: {
      projectId: number;
      platformName: "Android" | "iOS";
      deviceName?: string;
      version?: string;
      realDevice?: boolean;
      name?: string;
      env?: Record<string, string>;
      includeTags?: string[];
      excludeTags?: string[];
      shardSplit?: number;
      otherApps?: string[];
    }) => {
      try {
        const projectId = Number(args.projectId);
        const capabilities: MaestroCapabilities = {
          deviceName: args.deviceName || "*",
          platformName: args.platformName,
        };
        if (args.version) capabilities.version = args.version;
        if (args.name) capabilities.name = args.name;
        if (args.realDevice) capabilities.realDevice = "true";

        const maestroOptions: MaestroRunOptions = {};
        if (args.env && Object.keys(args.env).length > 0) maestroOptions.env = args.env;
        if (args.includeTags?.length) maestroOptions.includeTags = args.includeTags;
        if (args.excludeTags?.length) maestroOptions.excludeTags = args.excludeTags;

        logger.info({ projectId, capabilities }, "Starting Maestro run");
        const started = await client().startRun(
          projectId,
          capabilities,
          maestroOptions,
          args.shardSplit,
          args.otherApps
        );

        const runs = started.runs || [];
        const runList = runs
          .map(
            (run) =>
              `- Run **${run.id}**${run.flows?.length ? ` (${run.flows.length} flow${run.flows.length === 1 ? "" : "s"})` : ""}`
          )
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text:
                `Maestro run started on project ${projectId} (running asynchronously).\n\n${runList || "Run queued; IDs not yet available."}\n\n` +
                `Poll progress with getMaestroRunStatus (every 10-15 seconds), then fetch getMaestroRunResults when completed.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("runMaestroTest", error);
      }
    }
  );

  tools.getMaestroRunStatus = server.tool(
    "getMaestroRunStatus",
    "Get the status of Maestro run(s) for a project. Omit runId to list all runs of the latest execution. Statuses: WAITING, READY (running), DONE, FAILED, CANCELLED.",
    {
      projectId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .describe("Project ID"),
      runId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .optional()
        .describe("Specific run ID to inspect"),
    },
    async (args: { projectId: number; runId?: number }) => {
      try {
        const projectId = Number(args.projectId);
        if (args.runId) {
          const run = await client().getRun(projectId, Number(args.runId));
          const done = run.completed
            ? "\n\nRun is complete — fetch getMaestroRunResults for the full report."
            : "";
          return {
            content: [
              {
                type: "text",
                text: `## Maestro Run Status (project ${projectId})\n\n${formatRun(run)}${done}`,
              },
            ],
          };
        }

        const status = await client().getProjectStatus(projectId);
        let out = `## Maestro Runs (project ${projectId}) — ${status.completed ? "completed" : "in progress"}\n\n`;
        for (const run of status.runs || []) {
          out += formatRun(run) + "\n";
        }
        return { content: [{ type: "text", text: out }] };
      } catch (error) {
        return handleMCPError("getMaestroRunStatus", error);
      }
    }
  );

  tools.getMaestroRunResults = server.tool(
    "getMaestroRunResults",
    "Get the final results of a completed Maestro run: per-flow outcomes (failures first, with error messages and video links) plus the JUnit XML report.",
    {
      projectId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .describe("Project ID"),
      runId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .describe("Run ID"),
    },
    async (args: { projectId: number; runId: number }) => {
      try {
        const projectId = Number(args.projectId);
        const runId = Number(args.runId);
        const run = await client().getRun(projectId, runId);

        let junit = "";
        try {
          junit = await client().getJunitReport(projectId, runId);
        } catch {
          junit = "(JUnit report not available yet)";
        }

        const outcome =
          run.status === "DONE" && run.success
            ? "PASSED ✅"
            : run.status === "FAILED" || !run.success
              ? "FAILED ❌"
              : run.status;
        const text =
          `## Maestro Run ${runId} Results — ${outcome}\n\n${formatRun(run)}\n` +
          `### JUnit Report\n\n\`\`\`xml\n${junit}\n\`\`\``;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return handleMCPError("getMaestroRunResults", error);
      }
    }
  );

  tools.uploadMaestroCompanionApp = server.tool(
    "uploadMaestroCompanionApp",
    "Upload a companion app (.apk/.aab/.ipa) that should be installed alongside the app under test in a Maestro run. Returns a tb:// app URL to pass in runMaestroTest's otherApps parameter (max 4 per run).",
    {
      localFilePath: z.string().describe("Local path to the companion .apk, .aab, .ipa or .zip"),
    },
    async (args: { localFilePath: string }) => {
      try {
        const safePath = validateAppPath(args.localFilePath);
        logger.info({ path: safePath }, "Uploading Maestro companion app");

        const result = await client().uploadOtherApp(safePath);
        return {
          content: [
            {
              type: "text",
              text: `Companion app uploaded successfully!\n\n**App URL**: ${result.app_url}\n\nPass this URL in runMaestroTest's otherApps parameter to install it alongside the app under test.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("uploadMaestroCompanionApp", error);
      }
    }
  );

  tools.listMaestroProjects = server.tool(
    "listMaestroProjects",
    "List Maestro projects on the account (newest first): app details, flow names, and run IDs. Use this to find an existing projectId instead of re-uploading an app.",
    {
      offset: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().min(0))
        .optional()
        .default(0)
        .describe("Offset for pagination (default: 0)"),
      count: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().min(1).max(100))
        .optional()
        .default(10)
        .describe("Number of projects to retrieve (default: 10, max: 100)"),
    },
    async (args: { offset?: number; count?: number }) => {
      try {
        const offset = Number(args.offset ?? 0);
        const count = Number(args.count ?? 10);
        const result = await client().listProjects(offset, count);
        const projects = result.data || [];

        let out = `## Maestro Projects (${projects.length} of ${result.meta?.total ?? "?"}, offset ${offset})\n\n`;
        if (projects.length === 0) {
          out += "No Maestro projects found.\n";
        }
        for (const project of projects) {
          out += `### Project ${project.id}${project.name ? ` — ${project.name}` : ""} (${project.completed ? "completed" : "in progress"})\n`;
          if (project.app?.bundle_id) {
            out += `- **App**: ${project.app.bundle_id}${project.app.app_version ? ` v${project.app.app_version}` : ""}\n`;
          }
          if (project.flows?.length) {
            out += `- **Flows**: ${project.flows.map((f) => f.name || `#${f.id}`).join(", ")}\n`;
          }
          if (project.runs?.length) {
            out += `- **Run IDs**: ${project.runs.join(", ")}\n`;
          }
          if (project.created_at) {
            out += `- **Created**: ${project.created_at}\n`;
          }
          out += "\n";
        }
        return { content: [{ type: "text", text: out }] };
      } catch (error) {
        return handleMCPError("listMaestroProjects", error);
      }
    }
  );

  tools.listMaestroRuns = server.tool(
    "listMaestroRuns",
    "List Maestro runs across all projects (newest first), or look up runs by their build/run name. Returns projectId + runId pairs for use with getMaestroRunStatus and getMaestroRunResults.",
    {
      buildName: z
        .string()
        .optional()
        .describe("Look up runs with this exact run name instead of listing all runs"),
      offset: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().min(0))
        .optional()
        .default(0)
        .describe("Offset for pagination (default: 0; ignored with buildName)"),
      count: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().min(1).max(100))
        .optional()
        .default(10)
        .describe("Number of runs to retrieve (default: 10, max: 100; ignored with buildName)"),
    },
    async (args: { buildName?: string; offset?: number; count?: number }) => {
      try {
        let runs;
        let heading;
        if (args.buildName) {
          const result = await client().findRunsByBuildName(args.buildName);
          runs = result.data || [];
          heading = `## Maestro Runs named "${args.buildName}" (${runs.length})\n\n`;
        } else {
          const offset = Number(args.offset ?? 0);
          const count = Number(args.count ?? 10);
          const result = await client().listRuns(offset, count);
          runs = result.data || [];
          heading = `## Maestro Runs (${runs.length} of ${result.meta?.total ?? "?"}, offset ${offset})\n\n`;
        }

        let out = heading;
        if (runs.length === 0) {
          out += "No Maestro runs found.\n";
        }
        for (const run of runs) {
          const caps = run.capabilities as { deviceName?: string } | undefined;
          const outcome =
            run.status === "DONE" && run.success
              ? "PASSED"
              : run.status === "FAILED" || (run.status === "DONE" && !run.success)
                ? "FAILED"
                : run.status;
          out += `- Run **${run.id}** (project ${run.project_id})${run.name ? ` "${run.name}"` : ""} — ${outcome}`;
          if (caps?.deviceName) out += ` on ${caps.deviceName}`;
          if (run.created_at) out += `, started ${run.created_at}`;
          out += "\n";
        }
        out +=
          "\nUse getMaestroRunStatus / getMaestroRunResults with a projectId + runId for details.";
        return { content: [{ type: "text", text: out }] };
      } catch (error) {
        return handleMCPError("listMaestroRuns", error);
      }
    }
  );

  tools.getMaestroFlowDetails = server.tool(
    "getMaestroFlowDetails",
    "Get the detailed result of a single Maestro flow: error messages, step-level JUnit report, and links to the video, screenshots, and device logs. Use this to diagnose why a flow failed before fixing it and calling retryMaestroRun.",
    {
      projectId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .describe("Project ID"),
      runId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .describe("Run ID"),
      flowId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .describe("Flow ID (from getMaestroRunStatus output)"),
    },
    async (args: { projectId: number; runId: number; flowId: number }) => {
      try {
        const flow = await client().getFlowResult(
          Number(args.projectId),
          Number(args.runId),
          Number(args.flowId)
        );

        const outcome =
          flow.status === "DONE" && flow.success
            ? "PASSED ✅"
            : flow.status === "FAILED" || flow.success === 0
              ? "FAILED ❌"
              : flow.status;
        let text = `## Flow "${flow.name}" (id ${flow.id}) — ${outcome}\n\n`;
        if (flow.error_messages?.length) {
          text += `### Errors\n${flow.error_messages.map((m) => `- ${m}`).join("\n")}\n\n`;
        }
        if (flow.test?.environment?.name) {
          const env = flow.test.environment;
          text += `- **Device**: ${env.name}${env.version ? ` (${env.version})` : ""}\n`;
        }
        if (flow.test?.sessionId) {
          text += `- **Session ID**: ${flow.test.sessionId}\n`;
        }
        if (flow.completed_at) {
          text += `- **Completed**: ${flow.completed_at}\n`;
        }
        if (flow.assets) {
          text += `\n### Assets\n`;
          if (flow.assets.video) text += `- **Video**: ${flow.assets.video}\n`;
          if (flow.assets.screenshots?.length) {
            text += flow.assets.screenshots.map((s) => `- **Screenshot**: ${s}`).join("\n") + "\n";
          }
          if (flow.assets.logs) {
            text += `- **Logs**: ${
              typeof flow.assets.logs === "string"
                ? flow.assets.logs
                : JSON.stringify(flow.assets.logs)
            }\n`;
          }
        } else if (flow.assets_synced === false) {
          text += `\nAssets (video/screenshots/logs) are still syncing — check again shortly.\n`;
        }
        if (flow.report) {
          text += `\n### Step Report\n\n\`\`\`xml\n${flow.report}\n\`\`\``;
        }

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return handleMCPError("getMaestroFlowDetails", error);
      }
    }
  );

  tools.cancelMaestroRun = server.tool(
    "cancelMaestroRun",
    "Cancel a running Maestro run.",
    {
      projectId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .describe("Project ID"),
      runId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .describe("Run ID to cancel"),
    },
    async (args: { projectId: number; runId: number }) => {
      try {
        await client().cancelRun(Number(args.projectId), Number(args.runId));
        return { content: [{ type: "text", text: `Maestro run ${args.runId} cancelled.` }] };
      } catch (error) {
        return handleMCPError("cancelMaestroRun", error);
      }
    }
  );

  tools.retryMaestroRun = server.tool(
    "retryMaestroRun",
    "Retry a Maestro run, or a single failed flow within it when flowId is given.",
    {
      projectId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .describe("Project ID"),
      runId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .describe("Run ID to retry"),
      flowId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .optional()
        .describe("Retry only this flow (from getMaestroRunStatus output)"),
    },
    async (args: { projectId: number; runId: number; flowId?: number }) => {
      try {
        const projectId = Number(args.projectId);
        const runId = Number(args.runId);
        if (args.flowId) {
          await client().retryFlow(projectId, runId, Number(args.flowId));
        } else {
          await client().retryRun(projectId, runId);
        }
        return {
          content: [
            {
              type: "text",
              text: `Retry queued for ${args.flowId ? `flow ${args.flowId} of ` : ""}run ${runId}. Poll with getMaestroRunStatus.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("retryMaestroRun", error);
      }
    }
  );

  return tools;
}
