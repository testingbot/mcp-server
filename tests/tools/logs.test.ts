import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import addLogTools from "../../src/tools/logs.js";

const SELENIUM_LOG = [
  "INFO: Starting session",
  "INFO: Navigating to https://example.com",
  "ERROR: ElementNotFoundException at line 42",
  "  at FindElement(By.id(\"login\")):84",
  "INFO: Cleanup",
].join("\n");

const BROWSER_LOG = [
  "[INFO] page loaded",
  "[INFO] all OK",
].join("\n");

describe("Log Tools — getFailureLogs", () => {
  let serverMock: any;
  let testingBotApiMock: any;
  let configMock: any;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => ({ name, desc, schema, handler })),
    };
    testingBotApiMock = { getTestDetails: vi.fn() };
    configMock = { "testingbot-key": "k", "testingbot-secret": "s" };

    fetchSpy = vi.fn(async (url: string) => {
      const body =
        url.includes("selenium") ? SELENIUM_LOG :
        url.includes("browser") ? BROWSER_LOG :
        "";
      return {
        ok: true,
        status: 200,
        text: async () => body,
      } as Response;
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches all available log types by default", async () => {
    testingBotApiMock.getTestDetails.mockResolvedValue({
      logs: {
        selenium: "https://logs.example.com/selenium",
        browser: "https://logs.example.com/browser",
      },
    });

    const tools = addLogTools(serverMock, testingBotApiMock, configMock);
    const result = await tools.getFailureLogs.handler({ sessionId: "abc-123" });

    expect(testingBotApiMock.getTestDetails).toHaveBeenCalledWith("abc-123");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.content[0].text).toContain("### selenium");
    expect(result.content[0].text).toContain("### browser");
    expect(result.content[0].text).toContain("ElementNotFoundException");
  });

  it("respects the logTypes filter", async () => {
    testingBotApiMock.getTestDetails.mockResolvedValue({
      logs: {
        selenium: "https://logs.example.com/selenium",
        browser: "https://logs.example.com/browser",
        chrome: "https://logs.example.com/chrome",
      },
    });

    const tools = addLogTools(serverMock, testingBotApiMock, configMock);
    const result = await tools.getFailureLogs.handler({
      sessionId: "abc-123",
      logTypes: ["selenium"],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://logs.example.com/selenium",
      expect.any(Object)
    );
    expect(result.content[0].text).toContain("### selenium");
    expect(result.content[0].text).not.toContain("### browser");
  });

  it("filters to failure-relevant lines when failuresOnly=true", async () => {
    testingBotApiMock.getTestDetails.mockResolvedValue({
      logs: { selenium: "https://logs.example.com/selenium" },
    });

    const tools = addLogTools(serverMock, testingBotApiMock, configMock);
    const result = await tools.getFailureLogs.handler({
      sessionId: "abc-123",
      failuresOnly: true,
    });

    const text = result.content[0].text;
    expect(text).toContain("ElementNotFoundException");
    // "INFO: Starting session" is non-failure noise and should not appear in
    // failures-only mode (it's not in any context window of a failure line).
    expect(text).not.toContain("INFO: Starting session");
  });

  it("emits a placeholder when failuresOnly matches nothing", async () => {
    testingBotApiMock.getTestDetails.mockResolvedValue({
      logs: { browser: "https://logs.example.com/browser" },
    });

    const tools = addLogTools(serverMock, testingBotApiMock, configMock);
    const result = await tools.getFailureLogs.handler({
      sessionId: "abc-123",
      logTypes: ["browser"],
      failuresOnly: true,
    });

    expect(result.content[0].text).toContain("no failure-relevant lines matched");
  });

  it("truncates large logs to the last maxBytesPerLog bytes", async () => {
    const huge = "x".repeat(2000) + "\nERROR: at the end\n";
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => huge,
    } as Response);

    testingBotApiMock.getTestDetails.mockResolvedValue({
      logs: { selenium: "https://logs.example.com/selenium" },
    });

    const tools = addLogTools(serverMock, testingBotApiMock, configMock);
    const result = await tools.getFailureLogs.handler({
      sessionId: "abc-123",
      logTypes: ["selenium"],
      maxBytesPerLog: 1000,
    });

    expect(result.content[0].text).toContain("truncated");
    expect(result.content[0].text).toContain("ERROR: at the end");
  });

  it("reports per-log fetch errors without failing the whole call", async () => {
    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "" } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => BROWSER_LOG } as Response);

    testingBotApiMock.getTestDetails.mockResolvedValue({
      logs: {
        selenium: "https://logs.example.com/selenium",
        browser: "https://logs.example.com/browser",
      },
    });

    const tools = addLogTools(serverMock, testingBotApiMock, configMock);
    const result = await tools.getFailureLogs.handler({ sessionId: "abc-123" });

    expect(result.content[0].text).toContain("fetch failed");
    expect(result.content[0].text).toContain("HTTP 404");
    expect(result.content[0].text).toContain("### browser");
  });

  it("returns a helpful message when no log URLs are available", async () => {
    testingBotApiMock.getTestDetails.mockResolvedValue({ logs: {} });

    const tools = addLogTools(serverMock, testingBotApiMock, configMock);
    const result = await tools.getFailureLogs.handler({ sessionId: "abc-123" });

    expect(result.content[0].text).toContain("No log URLs available");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects empty session IDs after sanitization", async () => {
    const tools = addLogTools(serverMock, testingBotApiMock, configMock);
    const result = await tools.getFailureLogs.handler({ sessionId: "!@#$%" });

    expect(result.isError).toBe(true);
    expect(testingBotApiMock.getTestDetails).not.toHaveBeenCalled();
  });

  it("surfaces getTestDetails errors", async () => {
    testingBotApiMock.getTestDetails.mockRejectedValue(new Error("API down"));

    const tools = addLogTools(serverMock, testingBotApiMock, configMock);
    const result = await tools.getFailureLogs.handler({ sessionId: "abc-123" });

    expect(result.isError).toBe(true);
  });

  it("sanitizes the sessionId before calling the API", async () => {
    testingBotApiMock.getTestDetails.mockResolvedValue({ logs: {} });

    const tools = addLogTools(serverMock, testingBotApiMock, configMock);
    await tools.getFailureLogs.handler({ sessionId: "abc-123/../admin" });

    expect(testingBotApiMock.getTestDetails).toHaveBeenCalledWith("abc-123admin");
  });
});
