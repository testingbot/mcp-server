import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

// Visual testing review via /v1/visual/* (testingbot/web#774): list hosted
// visual tests and runs, explain what changed in a run, approve or reject it.
// The per-region AI descriptions are written by TestingBot when a run fails,
// only for accounts whose owner turned on AI region names; reading a run never
// sends anything to an AI provider.

const intArg = (min: number, max: number) =>
  z.union([z.number(), z.string().transform(Number)]).pipe(z.number().int().min(min).max(max));

const boolArg = () =>
  z.union([z.boolean(), z.string().transform((s) => s === "true")]).pipe(z.boolean());

interface VisualRunSummary {
  id: number;
  test_id?: number | null;
  name?: string;
  browser?: string | null;
  state: string;
  passed: boolean | null;
  rejected: boolean;
  mismatch_pct: number;
  threshold: number;
  created_at?: string;
  run_url?: string;
}

interface VisualRegion {
  number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  changed_pct: number;
  kind: string;
  name?: string | null;
  change?: string | null;
  ai_described: boolean;
  text_change?: string | null;
  css_changes?: string[];
  faint?: boolean;
  rendering_only?: boolean;
}

interface VisualRunDetail extends VisualRunSummary {
  regions: VisualRegion[];
  ai_region_names: boolean;
  screenshot_url?: string | null;
  baseline_url?: string | null;
  diff_url?: string | null;
}

function verdict(run: VisualRunSummary): string {
  if (run.state !== "done") return run.state;
  if (run.rejected) return "rejected";
  return run.passed ? "passed" : "failed";
}

function runLine(run: VisualRunSummary): string {
  return `- **#${run.id}** ${run.name ?? ""} · ${run.browser ?? "?"} · ${verdict(run)} · ${run.mismatch_pct}% changed (threshold ${run.threshold}%) · ${run.created_at ?? ""}\n  ${run.run_url ?? ""}`;
}

export function formatRunDetail(run: VisualRunDetail): string {
  let out = `## Visual run #${run.id}: ${run.name ?? ""}\n\n`;
  out += `- **Browser**: ${run.browser ?? "?"}\n`;
  out += `- **Result**: ${verdict(run)} · ${run.mismatch_pct}% of pixels changed (threshold ${run.threshold}%)\n`;
  out += `- **Run page**: ${run.run_url ?? ""}\n\n`;

  const regions = run.regions ?? [];
  if (regions.length === 0) {
    out += "_No changed regions recorded for this run._\n\n";
  } else {
    out += `### What changed (${regions.length} region${regions.length === 1 ? "" : "s"})\n\n`;
    for (const r of regions) {
      const label = r.name ? `“${r.name}”` : "unnamed region";
      out += `${r.number}. ${label} [${r.kind}] at ${r.x},${r.y} ${r.width}×${r.height}px, ${r.changed_pct}% of the page`;
      const notes: string[] = [];
      if (r.faint) notes.push("barely visible");
      if (r.rendering_only) notes.push("rendering only: same text in the same place");
      if (notes.length) out += ` (${notes.join("; ")})`;
      out += "\n";
      if (r.change) out += `   - Change (AI): ${r.change}\n`;
      if (r.text_change) out += `   - Text: ${r.text_change}\n`;
      for (const css of r.css_changes ?? []) out += `   - CSS: ${css}\n`;
    }
    out += "\n";
    out +=
      "_Kinds: new = changed in this run; repeating = changes on every run (a mask candidate); ignored = masked; matched = within its match level._\n";
    if (!run.ai_region_names) {
      out +=
        "_AI region names are off for this account, so regions are named from the page text only. The account owner can turn them on in Account Settings._\n";
    }
    out += "\n";
  }

  out += "### Images (links valid 1 hour)\n\n";
  if (run.screenshot_url) out += `- Screenshot: ${run.screenshot_url}\n`;
  if (run.baseline_url) out += `- Baseline: ${run.baseline_url}\n`;
  if (run.diff_url) out += `- Diff: ${run.diff_url}\n`;
  return out;
}

export default function addVisualTools(server: any, testingBotApi: any, _config: TestingBotConfig) {
  const tools: Record<string, any> = {};

  tools.getVisualTests = server.tool(
    "getVisualTests",
    "List the account's hosted visual regression tests with each test's ID, name, URL, browsers and whether it is paused. Read-only. Use it to find a `testId`, then getVisualRuns for its results. To review what changed in a run use explainVisualRun.",
    {
      offset: intArg(0, 100000).optional().default(0).describe("Skip this many tests."),
      limit: intArg(1, 100).optional().default(20).describe("Number of tests (max 100)."),
    },
    async (args: { offset?: number; limit?: number }) => {
      try {
        const body = await testingBotApi.request({
          method: "GET",
          url: "/visual/tests",
          data: { offset: args.offset ?? 0, count: args.limit ?? 20 },
        });
        const data: any[] = body?.data ?? [];
        if (data.length === 0)
          return { content: [{ type: "text", text: "No visual tests found." }] };
        let out = `## Visual tests (${data.length} of ${body?.meta?.total ?? data.length})\n\n`;
        for (const t of data) {
          out += `- **${t.name}** (id ${t.id}) · ${t.url} · ${t.browsers} browser${t.browsers === 1 ? "" : "s"}${t.paused ? " · paused" : ""}\n`;
        }
        return { content: [{ type: "text", text: out }] };
      } catch (error) {
        return handleMCPError("getVisualTests", error);
      }
    }
  );

  tools.getVisualRuns = server.tool(
    "getVisualRuns",
    "List visual runs (one browser's screenshot compared with its baseline), newest first, with each run's ID, name, browser, verdict, percentage of pixels changed versus its threshold, date and run page link. Read-only. Filter by `testId` (from getVisualTests) or `state`; `state: \"unreviewed\"` finds failed runs nobody has approved or rejected yet. Then use explainVisualRun on a run, and reviewVisualRun to approve or reject it.",
    {
      testId: intArg(1, Number.MAX_SAFE_INTEGER)
        .optional()
        .describe("Only runs of this visual test."),
      state: z.enum(["failed", "unreviewed", "passed"]).optional().describe("Filter by result."),
      offset: intArg(0, 100000).optional().default(0).describe("Skip this many runs."),
      limit: intArg(1, 100).optional().default(20).describe("Number of runs (max 100)."),
    },
    async (args: { testId?: number; state?: string; offset?: number; limit?: number }) => {
      try {
        const data: Record<string, unknown> = { offset: args.offset ?? 0, count: args.limit ?? 20 };
        if (args.testId) data.test_id = args.testId;
        if (args.state) data.state = args.state;
        const body = await testingBotApi.request({ method: "GET", url: "/visual/runs", data });
        const runs: VisualRunSummary[] = body?.data ?? [];
        if (runs.length === 0)
          return { content: [{ type: "text", text: "No visual runs found." }] };
        const out = `## Visual runs\n\n${runs.map(runLine).join("\n")}\n\nUse explainVisualRun with a run id to see what changed.\n`;
        return { content: [{ type: "text", text: out }] };
      } catch (error) {
        return handleMCPError("getVisualRuns", error);
      }
    }
  );

  tools.explainVisualRun = server.tool(
    "explainVisualRun",
    "Explain what changed in one visual run: each changed region and what it is, an AI description of the change when the account has AI region names on, text and CSS changes from the page, and links to the screenshot, baseline and diff images. Read-only and free. Get `runId` from getVisualRuns. Use it before reviewVisualRun to decide whether a change is intended.",
    {
      runId: intArg(1, Number.MAX_SAFE_INTEGER).describe("ID of the visual run."),
    },
    async (args: { runId: number }) => {
      try {
        const run: VisualRunDetail = await testingBotApi.request({
          method: "GET",
          url: `/visual/runs/${args.runId}`,
        });
        return { content: [{ type: "text", text: formatRunDetail(run) }] };
      } catch (error) {
        return handleMCPError("explainVisualRun", error);
      }
    }
  );

  tools.reviewVisualRun = server.tool(
    "reviewVisualRun",
    "Approve or reject a visual run, the same as on its run page in the dashboard. Approve when the change is intended, reject when it is a regression. With `makeBaseline: true`, approving also replaces that browser's baseline screenshot with this one, so later runs compare against it. Only call it when the user asked you to; review the change with explainVisualRun first. Get `runId` from getVisualRuns. Returns the updated run.",
    {
      runId: intArg(1, Number.MAX_SAFE_INTEGER).describe("ID of the visual run."),
      decision: z
        .enum(["approve", "reject"])
        .describe("approve (the change is intended) or reject."),
      makeBaseline: boolArg()
        .optional()
        .default(false)
        .describe("With approve: also make this screenshot the new baseline."),
    },
    async (args: { runId: number; decision: "approve" | "reject"; makeBaseline?: boolean }) => {
      try {
        logger.info({ runId: args.runId, decision: args.decision }, "Reviewing visual run");
        const run: VisualRunSummary = await testingBotApi.request({
          method: "POST",
          url: `/visual/runs/${args.runId}/${args.decision}`,
          data: args.decision === "approve" && args.makeBaseline ? { baseline: true } : {},
        });
        const baseline =
          args.decision === "approve" && args.makeBaseline ? " and set as the new baseline" : "";
        return {
          content: [
            {
              type: "text",
              text: `Visual run #${run.id} ${args.decision === "approve" ? "approved" : "rejected"}${baseline}.\n\n${runLine(run)}`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("reviewVisualRun", error);
      }
    }
  );

  return tools;
}
