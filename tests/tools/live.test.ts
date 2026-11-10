import { describe, it, expect, vi, beforeEach } from "vitest";
import addLiveTools, { desktopPlatformCode } from "../../src/tools/live.js";

// A slice of the /v1/browsers catalog: emulators/simulators carry deviceName.
const CATALOG = [
  { name: "googlechrome", platform: "WIN11", browser_id: 1, version: "140" },
  {
    name: "safari",
    platform: "VENTURA",
    platformName: "iOS",
    deviceName: "iPhone 14",
    browser_id: 100,
    version: "16.0",
  },
  {
    name: "safari",
    platform: "VENTURA",
    platformName: "iOS",
    deviceName: "iPhone 14 Pro",
    browser_id: 101,
    version: "16.0",
  },
  {
    name: "safari",
    platform: "VENTURA",
    platformName: "iOS",
    deviceName: "iPhone 13 Pro Max",
    browser_id: 102,
    version: "15.0",
  },
  {
    name: "safari",
    platform: "SONOMA",
    platformName: "iOS",
    deviceName: "iPhone 16",
    browser_id: 103,
    version: "18.0",
  },
  {
    name: "safari",
    platform: "SONOMA",
    platformName: "iOS",
    deviceName: "iPhone 16",
    browser_id: 104,
    version: "18.3",
  },
  {
    name: "chrome",
    platform: "ANDROID",
    platformName: "Android",
    deviceName: "Galaxy S23",
    browser_id: 200,
    version: "13.0",
  },
  {
    name: "browser",
    platform: "ANDROID",
    platformName: "Android",
    deviceName: "Galaxy S23 Ultra",
    browser_id: 201,
    version: "13.0",
  },
  {
    name: "chrome",
    platform: "ANDROID",
    platformName: "Android",
    deviceName: "Galaxy S23 Ultra",
    browser_id: 202,
    version: "13.0",
  },
  {
    name: "chrome",
    platform: "REAL_ANDROID",
    platformName: "Android",
    deviceName: "Galaxy A55",
    browser_id: 300,
    version: "14.0",
  },
];

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

    testingBotApiMock = { getBrowsers: vi.fn().mockResolvedValue(CATALOG) };

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

    it("links desktop sessions by browserName, version and platform", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startLiveSession.handler({
        platformType: "desktop",
        desiredURL: "https://example.com",
        desiredOS: "Mac",
        desiredOSVersion: "Monterey",
        desiredBrowser: "safari",
        desiredBrowserVersion: "16",
      });

      const text = result.content[0].text;
      expect(text).toContain(
        "https://testingbot.com/members/manual/start?url=https%3A%2F%2Fexample.com&browserName=safari&version=16&platform=MONTEREY"
      );
      expect(testingBotApiMock.getBrowsers).not.toHaveBeenCalled();
    });

    it("maps edge and ie to the catalog names", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);
      const edge = await tools.startDesktopLiveSession.handler({
        desiredURL: "https://example.com",
        desiredOS: "Windows",
        desiredOSVersion: "10",
        desiredBrowser: "edge",
      });
      expect(edge.content[0].text).toContain(
        "browserName=microsoftedge&version=latest&platform=WIN10"
      );
      const ie = await tools.startDesktopLiveSession.handler({
        desiredURL: "https://example.com",
        desiredOS: "Windows",
        desiredOSVersion: "10",
        desiredBrowser: "ie",
        desiredBrowserVersion: "11",
      });
      expect(ie.content[0].text).toContain("browserName=iexplore&version=11");
    });

    it("links mobile sessions by the emulator's browser id", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startLiveSession.handler({
        platformType: "mobile",
        desiredURL: "https://example.com",
        desiredOS: "android",
        desiredOSVersion: "13.0",
        desiredDevice: "Galaxy S23",
      });

      expect(result.content[0].text).toContain(
        "manual/start?url=https%3A%2F%2Fexample.com&browser=200"
      );
    });

    it("reports a mobile device the catalog does not have", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startLiveSession.handler({
        platformType: "mobile",
        desiredURL: "https://example.com",
        desiredOS: "ios",
        desiredOSVersion: "17.0",
        desiredDevice: "iPhone 16",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Available versions");
      expect(result.content[0].text).toContain("18.0, 18.3");
    });

    it("does not link real devices", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const result = await tools.startMobileLiveSession.handler({
        desiredURL: "https://example.com",
        desiredOS: "android",
        desiredOSVersion: "14",
        desiredDevice: "Galaxy A55",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("real devices");
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

      expect(result.content[0].text).toContain(
        "url=https%3A%2F%2Fexample.com%2Fpath%3Fquery%3Dvalue%26other%3Dtest"
      );
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

    it("matches exact device names before partial ones and prefers the platform browser", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);

      const pro = await tools.startMobileLiveSession.handler({
        desiredURL: "https://example.com",
        desiredOS: "ios",
        desiredOSVersion: "16",
        desiredDevice: "iphone 14",
      });
      expect(pro.content[0].text).toContain("browser=100");

      const ultra = await tools.startMobileLiveSession.handler({
        desiredURL: "https://example.com",
        desiredOS: "android",
        desiredOSVersion: "13",
        desiredDevice: "Galaxy S23 Ultra",
      });
      expect(ultra.content[0].text).toContain("browser=202");
    });

    it("picks the newest matching version", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.startMobileLiveSession.handler({
        desiredURL: "https://example.com",
        desiredOS: "ios",
        desiredOSVersion: "18",
        desiredDevice: "iPhone 16",
      });
      expect(result.content[0].text).toContain("browser=104");
    });

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

  describe("desktopPlatformCode", () => {
    it.each([
      ["Windows", "11", "WIN11"],
      ["Windows", "10", "WIN10"],
      ["Windows", "8.1", "WIN8_1"],
      ["Windows", "Windows 11", "WIN11"],
      ["Mac", "Sonoma", "SONOMA"],
      ["Mac", "macOS Sequoia", "SEQUOIA"],
      ["Mac", "Big Sur", "BIGSUR"],
      ["Mac", "High Sierra", "HIGH-SIERRA"],
      ["Mac", "14", "SONOMA"],
      ["Mac", "14.5", "SONOMA"],
      ["Mac", "10.15", "CATALINA"],
      ["Mac", "26", "TAHOE"],
      ["Mac", "ventura", "VENTURA"],
      ["Linux", "anything", "LINUX"],
      ["Windows", "win11", "WIN11"],
    ])("%s %s → %s", (os, version, code) => {
      expect(desktopPlatformCode(os, version)).toBe(code);
    });

    it("rejects unknown versions", () => {
      expect(() => desktopPlatformCode("Windows", "7")).toThrow(/Unknown Windows version/);
      expect(() => desktopPlatformCode("Mac", "Leopard")).toThrow(/Unknown macOS version/);
    });
  });

  describe("tunnels", () => {
    const desktop = {
      platformType: "desktop",
      desiredURL: "http://localhost:3000",
      desiredOS: "Windows",
      desiredOSVersion: "11",
      desiredBrowser: "chrome",
    };

    it("adds the tunnel to the session URL", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.startLiveSession.handler({ ...desktop, tunnelId: 265572 });
      const text = result.content[0].text;
      expect(text).toContain("&tunnel=265572");
      expect(text).toContain("Tunnel: 265572");
      expect(text).not.toContain("startTunnel");
    });

    it("accepts the tunnel ID as a string", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.startDesktopLiveSession.handler({
        desiredURL: "http://localhost:3000",
        desiredOS: "Windows",
        desiredOSVersion: "11",
        desiredBrowser: "chrome",
        tunnelId: "42",
      });
      expect(result.content[0].text).toContain("&tunnel=42");
    });

    it("adds the tunnel to mobile session URLs", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.startMobileLiveSession.handler({
        desiredURL: "http://localhost:3000",
        desiredOS: "android",
        desiredOSVersion: "13.0",
        desiredDevice: "Galaxy S23",
        tunnelId: 7,
      });
      expect(result.content[0].text).toContain("browser=200&tunnel=7");
    });

    it("warns when a local URL is opened without a tunnel", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.startLiveSession.handler(desktop);
      const text = result.content[0].text;
      expect(text).not.toContain("&tunnel=");
      expect(text).toContain("startTunnel");
      expect(text).toContain("tunnelId");
    });

    it("warns on mobile sessions too", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.startMobileLiveSession.handler({
        desiredURL: "http://192.168.1.20",
        desiredOS: "android",
        desiredOSVersion: "13.0",
        desiredDevice: "Galaxy S23",
      });
      expect(result.content[0].text).toContain("startTunnel");
    });

    it("does not warn for public URLs", async () => {
      const tools = addLiveTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.startLiveSession.handler({
        ...desktop,
        desiredURL: "https://example.com",
      });
      expect(result.content[0].text).not.toContain("startTunnel");
    });
  });
});
