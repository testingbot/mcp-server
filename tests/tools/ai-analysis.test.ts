import { describe, it, expect, vi, beforeEach } from "vitest";
import addAiAnalysisTools from "../../src/tools/ai-analysis.js";

vi.mock("../../src/lib/utils.js", async (orig) => {
  const actual: any = await orig();
  return { ...actual, sleep: vi.fn(() => Promise.resolve()) };
});

const complete = {
  test_id: 4711,
  session_id: "abc123",
  status: "complete",
  error: null,
  category: "element_not_found",
  owner_class: "application",
  confidence: 86,
  confidence_band: "high",
  sections: { summary: "The **Pay** button never appeared.", fixes: "1. Wait for the cart." },
  stale: false,
  test_url: "https://testingbot.com/members/tests/4711",
};

function notEnabledError() {
  const error: any = new Error("AI failure analysis is not enabled for this account.");
  error.statusCode = 403;
  error.response = { code: "ai_analysis_not_enabled", error: "not enabled" };
  return error;
}

describe("AI analysis tools", () => {
  let serverMock: any;
  let api: any;

  beforeEach(() => {
    vi.clearAllMocks();
    serverMock = { tool: vi.fn((name, desc, schema, handler) => ({ name, desc, schema, handler })) };
    api = { request: vi.fn() };
  });

  it("reads an analysis without starting one", async () => {
    api.request.mockResolvedValue(complete);
    const tools = addAiAnalysisTools(serverMock, api, {} as any);
    const result = await tools.getAiFailureAnalysis.handler({ sessionId: "abc123" });

    expect(api.request).toHaveBeenCalledWith({ method: "GET", url: "/tests/abc123/ai_analysis" });
    expect(result.content[0].text).toContain("element_not_found");
    expect(result.content[0].text).toContain("### Summary");
    expect(result.content[0].text).toContain("86/100");
  });

  it("explains how to enable the feature when the account has not opted in", async () => {
    api.request.mockRejectedValue(notEnabledError());
    const tools = addAiAnalysisTools(serverMock, api, {} as any);
    const result = await tools.analyzeTestFailure.handler({ sessionId: "abc123" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Account Settings > AI Analysis");
    expect(api.request).toHaveBeenCalledTimes(1);
  });

  it("starts an analysis and polls until it completes", async () => {
    api.request
      .mockResolvedValueOnce({ status: "pending", sections: {} })
      .mockResolvedValueOnce({ status: "running", sections: { summary: "partial" } })
      .mockResolvedValueOnce(complete);
    const tools = addAiAnalysisTools(serverMock, api, {} as any);
    const result = await tools.analyzeTestFailure.handler({ sessionId: "abc123", waitSeconds: 60 });

    expect(api.request.mock.calls[0][0]).toEqual({
      method: "POST",
      url: "/tests/abc123/ai_analysis",
      data: {},
    });
    expect(api.request).toHaveBeenCalledTimes(3);
    expect(result.content[0].text).toContain("**Status**: complete");
  });

  it("passes force and returns at once with waitSeconds 0", async () => {
    api.request.mockResolvedValueOnce({ status: "pending", sections: {} });
    const tools = addAiAnalysisTools(serverMock, api, {} as any);
    const result = await tools.analyzeTestFailure.handler({
      sessionId: "abc123",
      force: true,
      waitSeconds: 0,
    });

    expect(api.request.mock.calls[0][0].data).toEqual({ force: true });
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("Still running");
  });

  it("reports a test that is still running", async () => {
    const error: any = new Error("still running");
    error.statusCode = 409;
    api.request.mockRejectedValue(error);
    const tools = addAiAnalysisTools(serverMock, api, {} as any);
    const result = await tools.analyzeTestFailure.handler({ sessionId: "abc123" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("still running");
  });
});
