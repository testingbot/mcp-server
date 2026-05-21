import { describe, it, expect, vi, beforeEach } from "vitest";
import addBuildTools from "../../src/tools/builds.js";

describe("Build Tools", () => {
  let serverMock: any;
  let testingBotApiMock: any;
  let configMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => ({ name, desc, schema, handler })),
    };

    testingBotApiMock = {
      getBuilds: vi.fn(),
      getTestsForBuild: vi.fn(),
      deleteBuild: vi.fn(),
    };

    configMock = { "testingbot-key": "k", "testingbot-secret": "s" };
  });

  describe("getBuilds", () => {
    it("lists builds with default pagination", async () => {
      testingBotApiMock.getBuilds.mockResolvedValue({
        data: [
          { id: 1, name: "Nightly", tests: 12, created_at: "2025-01-01" },
          { id: 2, name: "Smoke", tests: 3, created_at: "2025-01-02" },
        ],
      });

      const tools = addBuildTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getBuilds.handler({});

      expect(testingBotApiMock.getBuilds).toHaveBeenCalledWith(0, 10);
      expect(result.content[0].text).toContain("Nightly");
      expect(result.content[0].text).toContain("Smoke");
      expect(result.content[0].text).toContain("**Tests**: 12");
    });

    it("handles empty build list", async () => {
      testingBotApiMock.getBuilds.mockResolvedValue({ data: [] });

      const tools = addBuildTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getBuilds.handler({ offset: 5, limit: 25 });

      expect(testingBotApiMock.getBuilds).toHaveBeenCalledWith(5, 25);
      expect(result.content[0].text).toContain("No builds found");
    });

    it("surfaces API errors", async () => {
      testingBotApiMock.getBuilds.mockRejectedValue(new Error("upstream down"));

      const tools = addBuildTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getBuilds.handler({});

      expect(result.isError).toBe(true);
    });

    it("uses build.id as title fallback when name is missing", async () => {
      testingBotApiMock.getBuilds.mockResolvedValue({
        data: [{ id: 42, tests: 1, created_at: "2025-01-01" }],
      });

      const tools = addBuildTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getBuilds.handler({});

      expect(result.content[0].text).toContain("### Build: 42");
    });
  });

  describe("getTestsForBuild", () => {
    it("lists tests for a build", async () => {
      testingBotApiMock.getTestsForBuild.mockResolvedValue({
        data: [
          {
            session_id: "abc",
            status: "passed",
            browser: "chrome",
            version: "120",
            platform: "WIN11",
            duration: 30,
          },
        ],
      });

      const tools = addBuildTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTestsForBuild.handler({ buildId: 7 });

      expect(testingBotApiMock.getTestsForBuild).toHaveBeenCalledWith(7);
      expect(result.content[0].text).toContain("Test abc");
      expect(result.content[0].text).toContain("chrome 120");
    });

    it("coerces string buildId to number", async () => {
      testingBotApiMock.getTestsForBuild.mockResolvedValue({ data: [] });

      const tools = addBuildTools(serverMock, testingBotApiMock, configMock);
      await tools.getTestsForBuild.handler({ buildId: "11" as unknown as number });

      expect(testingBotApiMock.getTestsForBuild).toHaveBeenCalledWith(11);
    });

    it("handles a build with no tests", async () => {
      testingBotApiMock.getTestsForBuild.mockResolvedValue({ data: [] });

      const tools = addBuildTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTestsForBuild.handler({ buildId: 1 });

      expect(result.content[0].text).toContain("No tests found for this build");
    });

    it("surfaces API errors", async () => {
      testingBotApiMock.getTestsForBuild.mockRejectedValue(new Error("not found"));

      const tools = addBuildTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTestsForBuild.handler({ buildId: 9 });

      expect(result.isError).toBe(true);
    });
  });

  describe("deleteBuild", () => {
    it("deletes a build", async () => {
      testingBotApiMock.deleteBuild.mockResolvedValue({});

      const tools = addBuildTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.deleteBuild.handler({ buildId: 5 });

      expect(testingBotApiMock.deleteBuild).toHaveBeenCalledWith(5);
      expect(result.content[0].text).toContain("Build 5 deleted successfully");
    });

    it("surfaces API errors", async () => {
      testingBotApiMock.deleteBuild.mockRejectedValue(new Error("forbidden"));

      const tools = addBuildTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.deleteBuild.handler({ buildId: 5 });

      expect(result.isError).toBe(true);
    });
  });
});
