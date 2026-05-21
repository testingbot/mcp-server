import { describe, it, expect, vi, beforeEach } from "vitest";
import addUserTools from "../../src/tools/user.js";

describe("User Tools", () => {
  let serverMock: any;
  let testingBotApiMock: any;
  let configMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => ({ name, desc, schema, handler })),
    };

    testingBotApiMock = {
      getUserInfo: vi.fn(),
      updateUserInfo: vi.fn(),
    };

    configMock = { "testingbot-key": "k", "testingbot-secret": "s" };
  });

  describe("getUserInfo", () => {
    it("formats full user info", async () => {
      testingBotApiMock.getUserInfo.mockResolvedValue({
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        minutes_used: 120,
        minutes_limit: 600,
        plan: "pro",
      });

      const tools = addUserTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getUserInfo.handler({});

      expect(testingBotApiMock.getUserInfo).toHaveBeenCalled();
      expect(result.content[0].text).toContain("Ada Lovelace");
      expect(result.content[0].text).toContain("ada@example.com");
      expect(result.content[0].text).toContain("**Minutes Used**: 120");
      expect(result.content[0].text).toContain("**Plan**: pro");
    });

    it("omits optional fields when missing", async () => {
      testingBotApiMock.getUserInfo.mockResolvedValue({
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
      });

      const tools = addUserTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getUserInfo.handler({});

      expect(result.content[0].text).not.toContain("Minutes Used");
      expect(result.content[0].text).not.toContain("Plan");
    });

    it("surfaces API errors", async () => {
      testingBotApiMock.getUserInfo.mockRejectedValue(new Error("unauthorized"));

      const tools = addUserTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getUserInfo.handler({});

      expect(result.isError).toBe(true);
    });
  });

  describe("updateUserInfo", () => {
    it("maps camelCase fields to snake_case for the API", async () => {
      testingBotApiMock.updateUserInfo.mockResolvedValue({});

      const tools = addUserTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.updateUserInfo.handler({
        firstName: "Grace",
        lastName: "Hopper",
        email: "grace@example.com",
      });

      expect(testingBotApiMock.updateUserInfo).toHaveBeenCalledWith({
        first_name: "Grace",
        last_name: "Hopper",
        email: "grace@example.com",
      });
      expect(result.content[0].text).toContain("updated successfully");
    });

    it("only forwards provided fields", async () => {
      testingBotApiMock.updateUserInfo.mockResolvedValue({});

      const tools = addUserTools(serverMock, testingBotApiMock, configMock);
      await tools.updateUserInfo.handler({ email: "new@example.com" });

      expect(testingBotApiMock.updateUserInfo).toHaveBeenCalledWith({ email: "new@example.com" });
    });

    it("surfaces API errors", async () => {
      testingBotApiMock.updateUserInfo.mockRejectedValue(new Error("validation failed"));

      const tools = addUserTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.updateUserInfo.handler({ firstName: "X" });

      expect(result.isError).toBe(true);
    });
  });
});
