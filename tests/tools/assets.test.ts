import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import addAssetTools, {
  parseConsoleLog,
  parseHar,
  summarizePerformance,
} from "../../src/tools/assets.js";

const HAR = JSON.stringify({
  log: {
    entries: [
      {
        request: { method: "GET", url: "https://example.com/" },
        response: { status: 200, bodySize: 1200, content: { mimeType: "text/html" } },
        time: 120.4,
      },
      {
        request: { method: "GET", url: "https://example.com/api/user" },
        response: { status: 500, bodySize: 40, content: { mimeType: "application/json" } },
        time: 2300,
      },
      {
        request: { method: "GET", url: "https://cdn.example.com/missing.js" },
        response: { status: 404, bodySize: 0, content: { mimeType: "text/plain" } },
        time: 30,
      },
      {
        request: { method: "POST", url: "https://tracker.example.net/collect" },
        response: { status: 0, bodySize: -1, content: {} },
        time: 0,
      },
    ],
  },
});

const CONSOLE = JSON.stringify({
  value: [
    { level: "INFO", message: "app booted", timestamp: 1700000000000 },
    { level: "WARNING", message: "deprecated API", timestamp: 1700000001000 },
    { level: "SEVERE", message: "Uncaught TypeError: x is undefined", timestamp: 1700000002000 },
  ],
});

const PERFORMANCE = JSON.stringify({
  chrome: [
    { cpu: "10.5", memory: "204800" },
    { cpu: "30.5", memory: "409600" },
  ],
  Network: [
    { sent: "1024", received: "4096" },
    { sent: "2048", received: "8192" },
  ],
});

const ASSETS = {
  session_id: "abc-123",
  video: "https://r2.example.com/video.mp4?sig",
  logs: {
    selenium: "https://r2.example.com/selenium.txt?sig",
    browser: "https://r2.example.com/browser.txt?sig",
  },
  har: "https://r2.example.com/abc.har?sig",
  performance: "https://r2.example.com/monitor.json?sig",
  screenshots: [{ image: "a" }, { image: "b" }],
};

describe("Asset Tools", () => {
  let serverMock: any;
  let apiMock: any;
  let fetchSpy: any;
  let tools: Record<string, any>;

  beforeEach(() => {
    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => ({ name, desc, schema, handler })),
    };
    apiMock = { request: vi.fn().mockResolvedValue(ASSETS) };
    fetchSpy = vi.fn(async (url: string) => {
      const body = url.includes(".har")
        ? HAR
        : url.includes("browser")
          ? CONSOLE
          : url.includes("monitor")
            ? PERFORMANCE
            : "";
      return { ok: true, status: 200, headers: new Headers(), text: async () => body } as Response;
    });
    vi.stubGlobal("fetch", fetchSpy);
    tools = addAssetTools(serverMock, apiMock, {
      "testingbot-key": "k",
      "testingbot-secret": "s",
    } as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers the four tools", () => {
    expect(Object.keys(tools).sort()).toEqual(
      ["getConsoleLogs", "getNetworkLog", "getPerformanceMetrics", "getTestAssets"].sort()
    );
  });

  describe("getTestAssets", () => {
    it("calls GET /tests/:id/assets with a sanitized id and lists every asset", async () => {
      const result = await tools.getTestAssets.handler({ sessionId: "abc-123;rm" });
      expect(apiMock.request).toHaveBeenCalledWith({
        method: "GET",
        url: "/tests/abc-123rm/assets",
      });
      const text = result.content[0].text;
      expect(text).toContain(ASSETS.video);
      expect(text).toContain(ASSETS.har);
      expect(text).toContain(ASSETS.performance);
      expect(text).toContain("**Screenshots**: 2");
      expect(text).toContain("browser (console)");
      expect(result.isError).toBeUndefined();
    });

    it("reports missing assets", async () => {
      apiMock.request.mockResolvedValue({
        session_id: "x",
        video: null,
        logs: {},
        har: null,
        performance: null,
        screenshots: [],
      });
      const text = (await tools.getTestAssets.handler({ sessionId: "x" })).content[0].text;
      expect(text).toContain("**HAR network capture**: _not available_");
      expect(text).toContain("_none available_");
    });

    it("returns an MCP error when the API fails", async () => {
      apiMock.request.mockRejectedValue(new Error("404 Not Found"));
      const result = await tools.getTestAssets.handler({ sessionId: "nope" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("404 Not Found");
    });
  });

  describe("getNetworkLog", () => {
    it("summarizes requests, failures and the slowest ones", async () => {
      const text = (await tools.getNetworkLog.handler({ sessionId: "abc-123" })).content[0].text;
      expect(fetchSpy).toHaveBeenCalledWith(ASSETS.har, expect.anything());
      expect(text).toContain("**Requests**: 4 · **Failed**: 3");
      expect(text).toContain("### Slowest requests");
      expect(text.indexOf("api/user")).toBeLessThan(text.indexOf("| GET | 200"));
    });

    it("filters to failed requests", async () => {
      const text = (await tools.getNetworkLog.handler({ sessionId: "abc-123", failedOnly: true }))
        .content[0].text;
      expect(text).toContain("### Failed requests (3 of 3)");
      expect(text).not.toContain("| GET | 200");
      expect(text).toContain("| POST | failed |");
    });

    it("filters by URL and respects the limit", async () => {
      const text = (
        await tools.getNetworkLog.handler({
          sessionId: "abc-123",
          urlContains: "EXAMPLE.COM",
          limit: 1,
        })
      ).content[0].text;
      expect(text).toContain('matching "EXAMPLE.COM" (1 of 3)');
    });

    it("says so when the session has no HAR", async () => {
      apiMock.request.mockResolvedValue({ ...ASSETS, har: null });
      const result = await tools.getNetworkLog.handler({ sessionId: "abc-123" });
      expect(result.content[0].text).toContain("no HAR network capture");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns the URL when the HAR cannot be parsed", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => "not json",
      });
      const result = await tools.getNetworkLog.handler({ sessionId: "abc-123" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(ASSETS.har);
    });

    it("refuses a file over the size limit", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(100 * 1024 * 1024) }),
        text: async () => HAR,
      });
      const result = await tools.getNetworkLog.handler({ sessionId: "abc-123" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("byte limit");
    });
  });

  describe("getConsoleLogs", () => {
    it("returns all entries with level counts", async () => {
      const text = (await tools.getConsoleLogs.handler({ sessionId: "abc-123" })).content[0].text;
      expect(fetchSpy).toHaveBeenCalledWith(ASSETS.logs.browser, expect.anything());
      expect(text).toContain("**Entries**: 3 (INFO: 1 · WARNING: 1 · SEVERE: 1)");
      expect(text).toContain("[INFO] app booted");
    });

    it("keeps only errors with minLevel=error", async () => {
      const text = (await tools.getConsoleLogs.handler({ sessionId: "abc-123", minLevel: "error" }))
        .content[0].text;
      expect(text).toContain("Uncaught TypeError");
      expect(text).not.toContain("deprecated API");
      expect(text).not.toContain("app booted");
    });

    it("keeps warnings and errors with minLevel=warning", async () => {
      const text = (
        await tools.getConsoleLogs.handler({ sessionId: "abc-123", minLevel: "warning" })
      ).content[0].text;
      expect(text).toContain("deprecated API");
      expect(text).not.toContain("app booted");
    });

    it("falls back to plain text for an unstructured log", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => "line one\nERROR something broke\nline three\n",
      });
      const text = (await tools.getConsoleLogs.handler({ sessionId: "abc-123", minLevel: "error" }))
        .content[0].text;
      expect(text).toContain("1 of 1 lines");
      expect(text).toContain("ERROR something broke");
    });

    it("says so when there is no console log", async () => {
      apiMock.request.mockResolvedValue({ ...ASSETS, logs: { selenium: "x" } });
      const text = (await tools.getConsoleLogs.handler({ sessionId: "abc-123" })).content[0].text;
      expect(text).toContain("no browser console log");
    });
  });

  describe("getPerformanceMetrics", () => {
    it("summarizes every numeric field per series", async () => {
      const text = (await tools.getPerformanceMetrics.handler({ sessionId: "abc-123" })).content[0]
        .text;
      expect(text).toContain("| chrome | cpu | 2 | 10.50 | 20.50 | 30.50 |");
      expect(text).toContain("| Network | received | 2 | 4096 | 6144 | 8192 |");
    });

    it("shows the raw start of an unrecognised file", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => "[1,2,3]",
      });
      const text = (await tools.getPerformanceMetrics.handler({ sessionId: "abc-123" })).content[0]
        .text;
      expect(text).toContain("not in a format");
      expect(text).toContain("[1,2,3]");
    });

    it("says so when there is no performance data", async () => {
      apiMock.request.mockResolvedValue({ ...ASSETS, performance: null });
      const text = (await tools.getPerformanceMetrics.handler({ sessionId: "abc-123" })).content[0]
        .text;
      expect(text).toContain("no performance data");
    });
  });

  describe("parsers", () => {
    it("parseHar tolerates a HAR without entries", () => {
      expect(parseHar("{}")).toEqual([]);
    });

    it("parseConsoleLog reads appended WebDriver log responses", () => {
      const two =
        CONSOLE + "\n" + JSON.stringify({ value: [{ level: "SEVERE", message: "second" }] });
      const entries = parseConsoleLog(two)!;
      expect(entries).toHaveLength(4);
      expect(entries[3].message).toBe("second");
    });

    it("parseConsoleLog returns null for plain text", () => {
      expect(parseConsoleLog("hello world")).toBeNull();
    });

    it("summarizePerformance ignores non-array series", () => {
      expect(summarizePerformance({ meta: "x", cpu: [{ v: 1 }] })).toEqual([
        { series: "cpu", field: "v", samples: 1, min: 1, avg: 1, max: 1 },
      ]);
    });
  });
});
