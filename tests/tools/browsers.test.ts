import { describe, it, expect, vi, beforeEach } from "vitest";
import addBrowserTools from "../../src/tools/browsers.js";

describe("Browser Tools", () => {
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

    testingBotApiMock = {
      getBrowsers: vi.fn(),
      getDevices: vi.fn(),
    };

    configMock = {
      "testingbot-key": "test-key",
      "testingbot-secret": "test-secret",
    };
  });

  describe("getBrowsers", () => {
    it("should register getBrowsers tool", () => {
      const tools = addBrowserTools(serverMock, testingBotApiMock, configMock);

      expect(tools.getBrowsers).toBeDefined();
      expect(tools.getBrowsers.name).toBe("getBrowsers");
    });

    it("should fetch and format browser list", async () => {
      const mockBrowsers = [
        {
          browserName: "chrome",
          version: "120",
          platform: "WIN11",
        },
        {
          browserName: "firefox",
          version: "119",
          platform: "MAC",
        },
      ];

      testingBotApiMock.getBrowsers.mockResolvedValue(mockBrowsers);

      const tools = addBrowserTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getBrowsers.handler({});

      expect(testingBotApiMock.getBrowsers).toHaveBeenCalledWith();
      expect(result.content[0].text).toContain("chrome");
      expect(result.content[0].text).toContain("firefox");
      expect(result.content[0].text).toContain("WIN11");
    });

    it("filters web vs mobile locally (the API's own type is the protocol)", async () => {
      testingBotApiMock.getBrowsers.mockResolvedValue([
        { name: "chrome", platform: "WIN11", version: "140" },
        {
          name: "chrome",
          platform: "ANDROID",
          version: "14.0",
          deviceName: "Pixel 8",
          browser_id: 5466,
        },
      ]);
      const tools = addBrowserTools(serverMock, testingBotApiMock, configMock);

      const mobile = (await tools.getBrowsers.handler({ type: "mobile" })).content[0].text;
      expect(testingBotApiMock.getBrowsers).toHaveBeenCalledWith();
      expect(mobile).toContain("Pixel 8");
      expect(mobile).toContain("5466");
      expect(mobile).not.toContain("WIN11");

      const web = (await tools.getBrowsers.handler({ type: "web" })).content[0].text;
      expect(web).toContain("WIN11");
      expect(web).not.toContain("Pixel 8");
    });

    it("should handle errors gracefully", async () => {
      testingBotApiMock.getBrowsers.mockRejectedValue(new Error("API Error"));

      const tools = addBrowserTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getBrowsers.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to get browsers");
    });
  });

  describe("getDevices", () => {
    it("should register getDevices tool", () => {
      const tools = addBrowserTools(serverMock, testingBotApiMock, configMock);

      expect(tools.getDevices).toBeDefined();
      expect(tools.getDevices.name).toBe("getDevices");
    });

    it("should fetch and format device list", async () => {
      const mockDevices = [
        {
          id: "device-1",
          name: "iPhone 14",
          platform: "iOS",
          version: "16.0",
          available: true,
        },
        {
          id: "device-2",
          name: "Samsung Galaxy S23",
          platform: "Android",
          version: "13.0",
          available: false,
        },
      ];

      testingBotApiMock.getDevices.mockResolvedValue(mockDevices);

      const tools = addBrowserTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getDevices.handler();

      expect(testingBotApiMock.getDevices).toHaveBeenCalled();
      expect(result.content[0].text).toContain("iPhone 14");
      expect(result.content[0].text).toContain("Samsung Galaxy S23");
      expect(result.content[0].text).toContain("**Available**: Yes");
      expect(result.content[0].text).toContain("**Available**: No");
    });

    it("should handle errors gracefully", async () => {
      testingBotApiMock.getDevices.mockRejectedValue(new Error("API Error"));

      const tools = addBrowserTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getDevices.handler();

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to get devices");
    });
  });
});
