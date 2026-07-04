import { describe, it, expect, vi, beforeEach } from "vitest";
import addTestTools from "../../src/tools/tests.js";

describe("Test Tools", () => {
  let serverMock: any;
  let testingBotApiMock: any;
  let configMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    serverMock = {
      tool: vi.fn((name, desc, schema, handler, extra) => {
        return { name, desc, schema, handler, ...(extra?._meta ? { _meta: extra._meta } : {}) };
      }),
    };

    testingBotApiMock = {
      getTests: vi.fn(),
      getTestDetails: vi.fn(),
      updateTest: vi.fn(),
      deleteTest: vi.fn(),
      stopTest: vi.fn(),
    };

    configMock = {
      "testingbot-key": "test-key",
      "testingbot-secret": "test-secret",
    };
  });

  describe("getTests", () => {
    it("should fetch and format test list", async () => {
      const mockTests = [
        {
          session_id: "test-123",
          status_id: 1, // 1 = Passed
          browser: "chrome",
          version: "120",
          os: "WIN11",
          duration: 45,
          video: "https://example.com/video.mp4",
          created_at: "2025-01-01T00:00:00Z",
          name: "Login Test",
        },
      ];

      testingBotApiMock.getTests.mockResolvedValue({ data: mockTests, meta: {} });

      const tools = addTestTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTests.handler({ offset: 0, limit: 10 });

      expect(testingBotApiMock.getTests).toHaveBeenCalledWith(0, 10);
      expect(result.content[0].text).toContain("test-123");
      expect(result.content[0].text).toContain("Passed");
      expect(result.content[0].text).toContain("Login Test");
    });

    it("should handle empty test list", async () => {
      testingBotApiMock.getTests.mockResolvedValue({ data: [], meta: {} });

      const tools = addTestTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTests.handler({});

      expect(result.content[0].text).toContain("No tests found");
    });

    it("formats browser and version with a separating space", async () => {
      // Regression test: previous code produced "chrome120" (no space).
      testingBotApiMock.getTests.mockResolvedValue({
        data: [
          { session_id: "a", browser: "chrome", version: "120" },
          { session_id: "b", browser: "firefox", browser_version: "115" },
          { session_id: "c", browser: "safari" }, // no version
        ],
        meta: {},
      });

      const tools = addTestTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTests.handler({});

      expect(result.content[0].text).toContain("**Browser**: chrome 120");
      expect(result.content[0].text).toContain("**Browser**: firefox 115");
      expect(result.content[0].text).toContain("**Browser**: safari");
      expect(result.content[0].text).not.toContain("chrome120");
      expect(result.content[0].text).not.toContain("firefox115");
    });
  });

  describe("getTestDetails", () => {
    it("should fetch and format test details", async () => {
      const mockTest = {
        session_id: "test-123",
        status_id: 1, // 1 = Passed
        browser: "chrome",
        version: "120",
        platform: "WIN11",
        duration: 45,
        video: "https://example.com/video.mp4",
        created_at: "2025-01-01T00:00:00Z",
        name: "Login Test",
        build: "Build #1",
        selenium_logs: "https://example.com/log.txt",
      };

      testingBotApiMock.getTestDetails.mockResolvedValue(mockTest);

      const tools = addTestTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTestDetails.handler({ sessionId: "test-123" });

      expect(testingBotApiMock.getTestDetails).toHaveBeenCalledWith("test-123");
      expect(result.content[0].text).toContain("test-123");
      expect(result.content[0].text).toContain("Video");
      expect(result.content[0].text).toContain("Build #1");
    });

    it("should sanitize session ID", async () => {
      testingBotApiMock.getTestDetails.mockResolvedValue({});

      const tools = addTestTools(serverMock, testingBotApiMock, configMock);
      await tools.getTestDetails.handler({ sessionId: "test-123@#$" });

      expect(testingBotApiMock.getTestDetails).toHaveBeenCalledWith("test-123");
    });

    it("links the MCP Apps test-details view via _meta", () => {
      const tools = addTestTools(serverMock, testingBotApiMock, configMock);

      expect(tools.getTestDetails._meta).toEqual({
        ui: { resourceUri: "ui://testingbot/test-details.html" },
      });
      // Only getTestDetails has a view; the other test tools stay meta-free.
      expect(tools.getTests._meta).toBeUndefined();
      expect(tools.updateTest._meta).toBeUndefined();
    });

    it("returns structuredContent mirroring the markdown", async () => {
      testingBotApiMock.getTestDetails.mockResolvedValue({
        session_id: "test-123",
        status_id: 0, // Failed
        status_message: "element not found",
        browser: "chrome",
        version: "120",
        os: "WIN11",
        duration: 45,
        created_at: "2025-01-01T00:00:00Z",
        name: "Login Test",
        video: "https://example.com/video.mp4",
        thumbs: ["https://example.com/thumb1.png", "https://example.com/thumb2.png"],
        logs: { selenium: "https://example.com/selenium.log" },
        steps: [{ command: "click", arguments: "#login", response: "ok", time: 1735689600000 }],
      });

      const tools = addTestTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTestDetails.handler({ sessionId: "test-123" });

      expect(result.structuredContent).toMatchObject({
        sessionId: "test-123",
        name: "Login Test",
        status: "Failed",
        statusMessage: "element not found",
        browser: "chrome 120",
        platform: "WIN11",
        duration: 45,
        video: "https://example.com/video.mp4",
        thumbs: ["https://example.com/thumb1.png", "https://example.com/thumb2.png"],
        logs: { selenium: "https://example.com/selenium.log", browser: null, chrome: null, vm: null },
        testUrl: "https://testingbot.com/members/tests/test-123",
      });
      expect(result.structuredContent.steps).toEqual([
        { command: "click", arguments: "#login", response: "ok", time: 1735689600000 },
      ]);
      // The markdown text stays intact for non-UI hosts.
      expect(result.content[0].text).toContain("Login Test");
    });

    it("omits structuredContent on API errors", async () => {
      testingBotApiMock.getTestDetails.mockRejectedValue(new Error("not found"));

      const tools = addTestTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTestDetails.handler({ sessionId: "missing" });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
    });
  });

  describe("updateTest", () => {
    it("should update test with all fields", async () => {
      testingBotApiMock.updateTest.mockResolvedValue({});

      const tools = addTestTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.updateTest.handler({
        sessionId: "test-123",
        name: "Updated Test",
        status: "passed",
        build: "Build #2",
      });

      expect(testingBotApiMock.updateTest).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Updated Test",
          "test[success]": "1",
          build: "Build #2",
        }),
        "test-123"
      );
      expect(result.content[0].text).toContain("Test test-123 updated successfully");
    });

    it("should convert status to success flag", async () => {
      testingBotApiMock.updateTest.mockResolvedValue({});

      const tools = addTestTools(serverMock, testingBotApiMock, configMock);
      await tools.updateTest.handler({ sessionId: "test-123", status: "failed" });

      expect(testingBotApiMock.updateTest).toHaveBeenCalledWith(
        expect.objectContaining({
          "test[success]": "0",
        }),
        "test-123"
      );
    });
  });

  describe("deleteTest", () => {
    it("should delete test successfully", async () => {
      testingBotApiMock.deleteTest.mockResolvedValue({});

      const tools = addTestTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.deleteTest.handler({ sessionId: "test-123" });

      expect(testingBotApiMock.deleteTest).toHaveBeenCalledWith("test-123");
      expect(result.content[0].text).toContain("deleted successfully");
    });
  });

  describe("stopTest", () => {
    it("should stop running test", async () => {
      testingBotApiMock.stopTest.mockResolvedValue({});

      const tools = addTestTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.stopTest.handler({ sessionId: "test-123" });

      expect(testingBotApiMock.stopTest).toHaveBeenCalledWith("test-123");
      expect(result.content[0].text).toContain("stopped successfully");
    });
  });
});
