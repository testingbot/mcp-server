import { describe, it, expect, vi, beforeEach } from "vitest";
import addTestTools from "../../src/tools/tests.js";

describe("Test Tools", () => {
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
