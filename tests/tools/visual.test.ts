import { describe, it, expect, vi, beforeEach } from "vitest";
import addVisualTools from "../../src/tools/visual.js";

const summary = {
  id: 99120,
  test_id: 812,
  name: "Pricing page",
  browser: "Chrome 149, Windows 11",
  state: "done",
  passed: false,
  rejected: false,
  mismatch_pct: 2.5,
  threshold: 0.1,
  created_at: "2026-11-16T08:00:40Z",
  run_url: "https://testingbot.com/members/visual/3301/runs/99120",
};

describe("Visual tools", () => {
  let serverMock: any;
  let api: any;

  beforeEach(() => {
    vi.clearAllMocks();
    serverMock = { tool: vi.fn((name, desc, schema, handler) => ({ name, desc, schema, handler })) };
    api = { request: vi.fn() };
  });

  it("lists unreviewed runs of a test", async () => {
    api.request.mockResolvedValue({ data: [summary] });
    const tools = addVisualTools(serverMock, api, {} as any);
    const result = await tools.getVisualRuns.handler({ testId: 812, state: "unreviewed" });

    expect(api.request).toHaveBeenCalledWith({
      method: "GET",
      url: "/visual/runs",
      data: { offset: 0, count: 20, test_id: 812, state: "unreviewed" },
    });
    expect(result.content[0].text).toContain("#99120");
    expect(result.content[0].text).toContain("failed");
  });

  it("explains a run's regions with the AI description and text change", async () => {
    api.request.mockResolvedValue({
      ...summary,
      ai_region_names: true,
      regions: [
        {
          number: 1,
          x: 120,
          y: 340,
          width: 260,
          height: 48,
          changed_pct: 1.9,
          kind: "new",
          name: "Pro plan price",
          change: "The monthly price changed from $49 to $59.",
          ai_described: true,
          text_change: "$49 → $59",
          css_changes: ["span.price color #111 → #222"],
        },
      ],
      screenshot_url: "https://r2/s.png",
      baseline_url: "https://r2/b.png",
      diff_url: null,
    });
    const tools = addVisualTools(serverMock, api, {} as any);
    const text = (await tools.explainVisualRun.handler({ runId: 99120 })).content[0].text;

    expect(api.request).toHaveBeenCalledWith({ method: "GET", url: "/visual/runs/99120" });
    expect(text).toContain("“Pro plan price” [new]");
    expect(text).toContain("Change (AI): The monthly price changed");
    expect(text).toContain("Text: $49 → $59");
    expect(text).toContain("CSS: span.price color");
    expect(text).not.toContain("AI region names are off");
  });

  it("says when AI region names are off", async () => {
    api.request.mockResolvedValue({
      ...summary,
      ai_region_names: false,
      regions: [
        {
          number: 1,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          changed_pct: 0.1,
          kind: "repeating",
          name: null,
          change: null,
          ai_described: false,
        },
      ],
    });
    const tools = addVisualTools(serverMock, api, {} as any);
    const text = (await tools.explainVisualRun.handler({ runId: 1 })).content[0].text;

    expect(text).toContain("AI region names are off");
  });

  it("approves a run and promotes it to baseline", async () => {
    api.request.mockResolvedValue({ ...summary, passed: true });
    const tools = addVisualTools(serverMock, api, {} as any);
    const result = await tools.reviewVisualRun.handler({
      runId: 99120,
      decision: "approve",
      makeBaseline: true,
    });

    expect(api.request).toHaveBeenCalledWith({
      method: "POST",
      url: "/visual/runs/99120/approve",
      data: { baseline: true },
    });
    expect(result.content[0].text).toContain("approved and set as the new baseline");
  });

  it("rejects a run without a baseline flag", async () => {
    api.request.mockResolvedValue({ ...summary, rejected: true });
    const tools = addVisualTools(serverMock, api, {} as any);
    await tools.reviewVisualRun.handler({ runId: 99120, decision: "reject", makeBaseline: true });

    expect(api.request).toHaveBeenCalledWith({
      method: "POST",
      url: "/visual/runs/99120/reject",
      data: {},
    });
  });
});
