import { describe, it, expect, vi, beforeEach } from "vitest";
import addLiveTools from "../../src/tools/live.js";

describe("Live Tools", () => {
  let serverMock: any;
  let testingBotApiMock: any;
  let configMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => {
        return { name, desc, schema, handler };
      }),
    };

    testingBotApiMock = {};

    configMock = {
      "testingbot-key": "test-key",
      "testingbot-secret": "test-secret",
    };
  });

  describe("startLiveSession", () => {
    it("should register startLiveSession tool", () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      expect(tools.startLiveSession).toBeDefined();
      expect(tools.startLiveSession.name).toBe("startLiveSession");
    });

    it("should start desktop live session", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startLiveSession.handler({
        platformType: "desktop",
        desiredURL: "https://example.com",
        desiredOS: "Windows",
        desiredOSVersion: "11",
        desiredBrowser: "chrome",
        desiredBrowserVersion: "latest",
      });

      expect(result.content[0].text).toContain("Live Session Ready");
      expect(result.content[0].text).toContain("https://testingbot.com/members/manual/start");
      expect(result.content[0].text).toContain("chrome");
      expect(result.content[0].text).toContain("Windows");
    });

    it("should start mobile live session", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startLiveSession.handler({
        platformType: "mobile",
        desiredURL: "https://example.com",
        desiredOS: "ios",
        desiredOSVersion: "16.0",
        desiredDevice: "iPhone 14",
      });

      expect(result.content[0].text).toContain("Live Session Ready");
      expect(result.content[0].text).toContain("https://testingbot.com/members/manual/start");
      expect(result.content[0].text).toContain("iPhone 14");
      expect(result.content[0].text).toContain("ios");
    });

    it("should construct correct environment ID for desktop", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startLiveSession.handler({
        platformType: "desktop",
        desiredURL: "https://example.com",
        desiredOS: "Mac",
        desiredOSVersion: "Monterey",
        desiredBrowser: "safari",
        desiredBrowserVersion: "16",
      });

      expect(result.content[0].text).toContain("browser=safari_16_mac_Monterey");
    });

    it("should construct correct environment ID for mobile", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startLiveSession.handler({
        platformType: "mobile",
        desiredURL: "https://example.com",
        desiredOS: "android",
        desiredOSVersion: "13.0",
        desiredDevice: "Galaxy S23",
      });

      expect(result.content[0].text).toContain("browser=android_13.0_Galaxy_S23");
    });

    it("should handle invalid URL", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startLiveSession.handler({
        platformType: "desktop",
        desiredURL: "not-a-url",
        desiredOS: "Windows",
        desiredOSVersion: "11",
        desiredBrowser: "chrome",
      });

      expect(result.isError).toBe(true);
    });

    it("should URL encode the target URL", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startLiveSession.handler({
        platformType: "desktop",
        desiredURL: "https://example.com/path?query=value&other=test",
        desiredOS: "Windows",
        desiredOSVersion: "11",
        desiredBrowser: "chrome",
        desiredBrowserVersion: "latest",
      });

      expect(result.content[0].text).toContain("url=https%3A%2F%2Fexample.com%2Fpath%3Fquery%3Dvalue%26other%3Dtest");
    });
  });

  describe("startDesktopLiveSession", () => {
    it("should register startDesktopLiveSession tool", () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      expect(tools.startDesktopLiveSession).toBeDefined();
      expect(tools.startDesktopLiveSession.name).toBe("startDesktopLiveSession");
    });

    it("should start desktop session with default browser version", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startDesktopLiveSession.handler({
        desiredURL: "https://example.com",
        desiredOS: "Windows",
        desiredOSVersion: "11",
        desiredBrowser: "chrome",
      });

      expect(result.content[0].text).toContain("Desktop Live Session Ready");
      expect(result.content[0].text).toContain("chrome latest");
      expect(result.content[0].text).toContain("https://testingbot.com/members/manual/start");
    });

    it("should include browser version when specified", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startDesktopLiveSession.handler({
        desiredURL: "https://example.com",
        desiredOS: "Mac",
        desiredOSVersion: "Monterey",
        desiredBrowser: "firefox",
        desiredBrowserVersion: "120",
      });

      expect(result.content[0].text).toContain("firefox 120");
    });
  });

  describe("startMobileLiveSession", () => {
    it("should register startMobileLiveSession tool", () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      expect(tools.startMobileLiveSession).toBeDefined();
      expect(tools.startMobileLiveSession.name).toBe("startMobileLiveSession");
    });

    it("should start iOS mobile session", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startMobileLiveSession.handler({
        desiredURL: "https://example.com",
        desiredOS: "ios",
        desiredOSVersion: "16.0",
        desiredDevice: "iPhone 14 Pro",
      });

      expect(result.content[0].text).toContain("Mobile Live Session Ready");
      expect(result.content[0].text).toContain("iPhone 14 Pro");
      expect(result.content[0].text).toContain("ios 16.0");
      expect(result.content[0].text).toContain("https://testingbot.com/members/manual/start");
    });

    it("should start Android mobile session", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startMobileLiveSession.handler({
        desiredURL: "https://example.com",
        desiredOS: "android",
        desiredOSVersion: "13.0",
        desiredDevice: "Galaxy S23 Ultra",
      });

      expect(result.content[0].text).toContain("Mobile Live Session Ready");
      expect(result.content[0].text).toContain("Galaxy S23 Ultra");
      expect(result.content[0].text).toContain("android 13.0");
    });

    it("should handle device names with spaces", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startMobileLiveSession.handler({
        desiredURL: "https://example.com",
        desiredOS: "ios",
        desiredOSVersion: "15.0",
        desiredDevice: "iPhone 13 Pro Max",
      });

      expect(result.content[0].text).toContain("browser=ios_15.0_iPhone_13_Pro_Max");
    });
  });

  describe("Error handling", () => {
    it("should handle errors gracefully", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startLiveSession.handler({
        platformType: "invalid",
        desiredURL: "https://example.com",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to start live session");
    });
  });
});
