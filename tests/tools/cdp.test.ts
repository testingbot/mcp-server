import { describe, it, expect, vi, beforeEach } from "vitest";
import addCdpTools from "../../src/tools/cdp.js";

describe("CDP Tools", () => {
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
      createSession: vi.fn(),
    };

    configMock = {
      "testingbot-key": "test-key",
      "testingbot-secret": "test-secret",
    };
  });

  describe("createCdpSession", () => {
    it("should create CDP session with basic capabilities", async () => {
      const mockSession = {
        session_id: "test-session-123",
        cdp_url: "wss://cloud.testingbot.com/session/test-session-123",
      };

      testingBotApiMock.createSession.mockResolvedValue(mockSession);

      const tools = addCdpTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.createCdpSession.handler({
        browserName: "chrome",
        browserVersion: "120",
        platform: "WIN11",
      });

      expect(testingBotApiMock.createSession).toHaveBeenCalledWith({
        capabilities: {
          browserName: "chrome",
          browserVersion: "120",
          platform: "WIN11",
        },
      });

      expect(result.content[0].text).toContain("test-session-123");
      expect(result.content[0].text).toContain("wss://cloud.testingbot.com/session/test-session-123");
      expect(result.content[0].text).toContain("chrome 120");
      expect(result.content[0].text).toContain("WIN11");
    });

    it("should create CDP session with latest browser version by default", async () => {
      const mockSession = {
        session_id: "test-session-456",
        cdp_url: "wss://cloud.testingbot.com/session/test-session-456",
      };

      testingBotApiMock.createSession.mockResolvedValue(mockSession);

      const tools = addCdpTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.createCdpSession.handler({
        browserName: "firefox",
        platform: "MONTEREY",
      });

      expect(testingBotApiMock.createSession).toHaveBeenCalledWith({
        capabilities: {
          browserName: "firefox",
          browserVersion: "latest",
          platform: "MONTEREY",
        },
      });

      expect(result.content[0].text).toContain("firefox latest");
    });

    it("should include optional capabilities when provided", async () => {
      const mockSession = {
        session_id: "test-session-789",
        cdp_url: "wss://cloud.testingbot.com/session/test-session-789",
      };

      testingBotApiMock.createSession.mockResolvedValue(mockSession);

      const tools = addCdpTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.createCdpSession.handler({
        browserName: "chrome",
        browserVersion: "latest",
        platform: "WIN11",
        screenResolution: "1920x1080",
        timeZone: "America/New_York",
        name: "My CDP Test",
        build: "Build #123",
      });

      expect(testingBotApiMock.createSession).toHaveBeenCalledWith({
        capabilities: {
          browserName: "chrome",
          browserVersion: "latest",
          platform: "WIN11",
          screenResolution: "1920x1080",
          timeZone: "America/New_York",
          name: "My CDP Test",
          build: "Build #123",
        },
      });

      expect(result.content[0].text).toContain("test-session-789");
    });

    it("should merge extra capabilities", async () => {
      const mockSession = {
        session_id: "test-session-extra",
        cdp_url: "wss://cloud.testingbot.com/session/test-session-extra",
      };

      testingBotApiMock.createSession.mockResolvedValue(mockSession);

      const tools = addCdpTools(serverMock, testingBotApiMock, configMock);
      await tools.createCdpSession.handler({
        browserName: "chrome",
        platform: "WIN11",
        extraCapabilities: {
          "tb:options": {
            idleTimeout: 300,
          },
          enableVNC: true,
        },
      });

      expect(testingBotApiMock.createSession).toHaveBeenCalledWith({
        capabilities: expect.objectContaining({
          browserName: "chrome",
          browserVersion: "latest",
          platform: "WIN11",
          "tb:options": {
            idleTimeout: 300,
          },
          enableVNC: true,
        }),
      });
    });

    it("should include Puppeteer connection example", async () => {
      const mockSession = {
        session_id: "test-session-puppeteer",
        cdp_url: "wss://cloud.testingbot.com/session/test-session-puppeteer",
      };

      testingBotApiMock.createSession.mockResolvedValue(mockSession);

      const tools = addCdpTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.createCdpSession.handler({
        browserName: "chrome",
        platform: "WIN11",
      });

      expect(result.content[0].text).toContain("Puppeteer");
      expect(result.content[0].text).toContain("puppeteer.connect");
      expect(result.content[0].text).toContain("browserWSEndpoint");
    });

    it("should include Playwright connection example", async () => {
      const mockSession = {
        session_id: "test-session-playwright",
        cdp_url: "wss://cloud.testingbot.com/session/test-session-playwright",
      };

      testingBotApiMock.createSession.mockResolvedValue(mockSession);

      const tools = addCdpTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.createCdpSession.handler({
        browserName: "chrome",
        platform: "WIN11",
      });

      expect(result.content[0].text).toContain("Playwright");
      expect(result.content[0].text).toContain("chromium.connectOverCDP");
    });

    it("should handle API errors", async () => {
      testingBotApiMock.createSession.mockRejectedValue(
        new Error("Session creation failed")
      );

      const tools = addCdpTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.createCdpSession.handler({
        browserName: "chrome",
        platform: "WIN11",
      });

      expect(result.isError).toBe(true);
    });

    it("should handle different browsers", async () => {
      const browsers = ["chrome", "firefox", "edge", "safari"];

      for (const browser of browsers) {
        const mockSession = {
          session_id: `test-session-${browser}`,
          cdp_url: `wss://cloud.testingbot.com/session/test-session-${browser}`,
        };

        testingBotApiMock.createSession.mockResolvedValue(mockSession);

        const tools = addCdpTools(serverMock, testingBotApiMock, configMock);
        const result = await tools.createCdpSession.handler({
          browserName: browser,
          platform: "WIN11",
        });

        expect(result.content[0].text).toContain(browser);
        expect(testingBotApiMock.createSession).toHaveBeenCalledWith(
          expect.objectContaining({
            capabilities: expect.objectContaining({
              browserName: browser,
            }),
          })
        );
      }
    });

    it("should handle different platforms", async () => {
      const platforms = ["WIN11", "WIN10", "MONTEREY", "BIGSUR", "HIGH-SIERRA"];

      for (const platform of platforms) {
        const mockSession = {
          session_id: `test-session-${platform}`,
          cdp_url: `wss://cloud.testingbot.com/session/test-session-${platform}`,
        };

        testingBotApiMock.createSession.mockResolvedValue(mockSession);

        const tools = addCdpTools(serverMock, testingBotApiMock, configMock);
        const result = await tools.createCdpSession.handler({
          browserName: "chrome",
          platform: platform,
        });

        expect(result.content[0].text).toContain(platform);
        expect(testingBotApiMock.createSession).toHaveBeenCalledWith(
          expect.objectContaining({
            capabilities: expect.objectContaining({
              platform: platform,
            }),
          })
        );
      }
    });
  });
});
