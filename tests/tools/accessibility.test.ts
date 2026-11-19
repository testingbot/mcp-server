import { describe, it, expect, vi, beforeEach } from "vitest";
import addAccessibilityTools from "../../src/tools/accessibility.js";

const summary = {
  id: 5120,
  test_id: 77,
  state: "done",
  passed: false,
  score: 92,
  wcag_issues_count: 3,
  needs_review_count: 1,
  recommendations_count: 0,
  severity: { critical: 0, serious: 3, moderate: 0, minor: 0 },
  created_at: "2026-11-16T06:00:04Z",
  run_url: "https://testingbot.com/members/accessibility/77/runs/5120",
};

describe("Accessibility tools", () => {
  let serverMock: any;
  let api: any;

  beforeEach(() => {
    vi.clearAllMocks();
    serverMock = { tool: vi.fn((name, desc, schema, handler) => ({ name, desc, schema, handler })) };
    api = { request: vi.fn() };
  });

  it("lists tests with their latest run", async () => {
    api.request.mockResolvedValue({
      data: [{ id: 77, name: "Checkout", url: "https://example.com/", paused: false, latest_run: summary }],
      meta: { total: 1 },
    });
    const tools = addAccessibilityTools(serverMock, api, {} as any);
    const text = (await tools.getAccessibilityTests.handler({})).content[0].text;

    expect(api.request).toHaveBeenCalledWith({
      method: "GET",
      url: "/accessibility/tests",
      data: { offset: 0, count: 20 },
    });
    expect(text).toContain("Checkout (id 77)");
    expect(text).toContain("score 92");
    expect(text).toContain("serious 3");
  });

  it("renders findings with elements and the diff against the previous scan", async () => {
    api.request.mockResolvedValue({
      ...summary,
      violations: [
        {
          rule: "color-contrast",
          impact: "serious",
          help: "Elements must meet minimum color contrast ratio thresholds",
          help_url: "https://dequeuniversity.com/rules/axe/4.11/color-contrast",
          wcag: ["wcag2aa", "wcag143"],
          elements_count: 3,
          elements: [
            {
              target: [".btn-secondary"],
              html: "<button>Apply</button>",
              failure_summary: "Fix any of the following:\n  insufficient contrast",
            },
          ],
        },
      ],
      recommendations: [],
      needs_review: [],
      new_violations: ["color-contrast|.btn-secondary"],
      resolved_violations: [],
    });
    const tools = addAccessibilityTools(serverMock, api, {} as any);
    const text = (await tools.getAccessibilityFindings.handler({ runId: 5120, elementsPerRule: 2 }))
      .content[0].text;

    expect(api.request).toHaveBeenCalledWith({
      method: "GET",
      url: "/accessibility/runs/5120",
      data: { nodes: 2 },
    });
    expect(text).toContain("### WCAG A/AA violations");
    expect(text).toContain("**color-contrast** (serious) [wcag2aa, wcag143]");
    expect(text).toContain("`.btn-secondary`");
    expect(text).toContain("1 new, 0 resolved");
    expect(text).toContain("does not mean the page is compliant");
  });

  it("starts a scan", async () => {
    api.request.mockResolvedValue({ success: true });
    const tools = addAccessibilityTools(serverMock, api, {} as any);
    const result = await tools.runAccessibilityTest.handler({ testId: 77 });

    expect(api.request).toHaveBeenCalledWith({ method: "POST", url: "/accessibility/tests/77/run" });
    expect(result.content[0].text).toContain("started");
  });

  it("reports API errors", async () => {
    const error: any = new Error("409 Conflict. This accessibility test is paused.");
    error.statusCode = 409;
    api.request.mockRejectedValue(error);
    const tools = addAccessibilityTools(serverMock, api, {} as any);
    const result = await tools.runAccessibilityTest.handler({ testId: 77 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("paused");
  });
});
