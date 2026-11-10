import { describe, it, expect, vi, beforeEach } from "vitest";
import addScreenshotTools from "../../src/tools/screenshots.js";

describe("Screenshot Tools", () => {
  let serverMock: any;
  let testingBotApiMock: any;
  let configMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => ({ name, desc, schema, handler })),
    };

    testingBotApiMock = {
      takeScreenshot: vi.fn(),
      retrieveScreenshots: vi.fn(),
      getScreenshotList: vi.fn(),
    };

    configMock = { "testingbot-key": "k", "testingbot-secret": "s" };
  });

  describe("takeScreenshot", () => {
    const validArgs = {
      url: "https://example.com",
      browsers: [{ browserName: "chrome", version: "latest", os: "WIN11" }],
      resolution: "1920x1080",
      waitTime: 5,
      fullPage: false,
    };

    it("creates a screenshot job", async () => {
      testingBotApiMock.takeScreenshot.mockResolvedValue({ id: "shot-123" });

      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.takeScreenshot.handler(validArgs);

      expect(testingBotApiMock.takeScreenshot).toHaveBeenCalledWith(
        validArgs.url,
        validArgs.browsers,
        validArgs.resolution,
        validArgs.waitTime,
        validArgs.fullPage
      );
      expect(result.content[0].text).toContain("shot-123");
      expect(result.content[0].text).toContain("retrieveScreenshots");
    });

    it("rejects invalid URLs", async () => {
      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.takeScreenshot.handler({ ...validArgs, url: "not-a-url" });

      expect(result.isError).toBe(true);
      expect(testingBotApiMock.takeScreenshot).not.toHaveBeenCalled();
    });

    it("surfaces API errors", async () => {
      testingBotApiMock.takeScreenshot.mockRejectedValue(new Error("quota exceeded"));

      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.takeScreenshot.handler(validArgs);

      expect(result.isError).toBe(true);
    });
  });

  describe("retrieveScreenshots", () => {
    it("formats completed screenshots", async () => {
      testingBotApiMock.retrieveScreenshots.mockResolvedValue({
        url: "https://example.com",
        state: "done",
        screenshots: [
          {
            browser: "chrome",
            version: "120",
            os: "WIN11",
            image_url: "https://img/1.png",
            thumb_url: "https://thumb/1.png",
          },
        ],
      });

      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.retrieveScreenshots.handler({ screenshotId: "shot-1" });

      expect(testingBotApiMock.retrieveScreenshots).toHaveBeenCalledWith("shot-1");
      expect(result.content[0].text).toContain("chrome 120 on WIN11");
      expect(result.content[0].text).toContain("https://img/1.png");
    });

    it("shows processing message when no screenshots yet", async () => {
      testingBotApiMock.retrieveScreenshots.mockResolvedValue({
        url: "https://example.com",
        state: "processing",
      });

      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.retrieveScreenshots.handler({ screenshotId: "shot-2" });

      expect(result.content[0].text).toContain("still processing");
    });

    it("surfaces API errors", async () => {
      testingBotApiMock.retrieveScreenshots.mockRejectedValue(new Error("not found"));

      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.retrieveScreenshots.handler({ screenshotId: "missing" });

      expect(result.isError).toBe(true);
    });
  });

  describe("getScreenshotList", () => {
    it("lists screenshot jobs", async () => {
      testingBotApiMock.getScreenshotList.mockResolvedValue({
        data: [
          { id: "a", url: "https://x", state: "done", created_at: "2025-01-01" },
          { id: "b", url: "https://y", state: "processing", created_at: "2025-01-02" },
        ],
      });

      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getScreenshotList.handler({ offset: 0, limit: 10 });

      expect(testingBotApiMock.getScreenshotList).toHaveBeenCalledWith(0, 10);
      expect(result.content[0].text).toContain("https://x");
      expect(result.content[0].text).toContain("https://y");
    });

    it("handles empty list", async () => {
      testingBotApiMock.getScreenshotList.mockResolvedValue({ data: [] });

      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getScreenshotList.handler({});

      expect(result.content[0].text).toContain("No screenshot jobs found");
    });

    it("surfaces API errors", async () => {
      testingBotApiMock.getScreenshotList.mockRejectedValue(new Error("upstream"));

      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getScreenshotList.handler({});

      expect(result.isError).toBe(true);
    });
  });

  describe("takeScreenshot of local URLs", () => {
    const localArgs = {
      url: "http://localhost:3000",
      browsers: [{ browserName: "chrome", version: "latest", os: "WIN11" }],
      resolution: "1920x1080",
    };

    it("refuses when no tunnel is running", async () => {
      testingBotApiMock.getTunnelList = vi.fn().mockResolvedValue([]);
      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.takeScreenshot.handler(localArgs);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("startTunnel");
      expect(testingBotApiMock.takeScreenshot).not.toHaveBeenCalled();
    });

    it("takes the screenshots when a tunnel is running", async () => {
      testingBotApiMock.getTunnelList = vi.fn().mockResolvedValue([{ id: 1, state: "READY" }]);
      testingBotApiMock.takeScreenshot.mockResolvedValue({ id: "shot-local" });
      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.takeScreenshot.handler(localArgs);
      expect(result.isError).toBeUndefined();
      expect(testingBotApiMock.takeScreenshot).toHaveBeenCalled();
    });

    it("does not block when the tunnel check fails", async () => {
      testingBotApiMock.getTunnelList = vi.fn().mockRejectedValue(new Error("down"));
      testingBotApiMock.takeScreenshot.mockResolvedValue({ id: "shot-local" });
      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      await tools.takeScreenshot.handler(localArgs);
      expect(testingBotApiMock.takeScreenshot).toHaveBeenCalled();
    });

    it("does not check tunnels for public URLs", async () => {
      testingBotApiMock.getTunnelList = vi.fn();
      testingBotApiMock.takeScreenshot.mockResolvedValue({ id: "shot-public" });
      const tools = addScreenshotTools(serverMock, testingBotApiMock, configMock);
      await tools.takeScreenshot.handler({ ...localArgs, url: "https://example.com" });
      expect(testingBotApiMock.getTunnelList).not.toHaveBeenCalled();
    });
  });
});
