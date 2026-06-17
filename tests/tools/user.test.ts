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
    it("formats user info using the fields the API actually returns", async () => {
      // Mirrors the real GET /v1/user payload: no `email`, and time is exposed
      // as `seconds` (not minutes_used/minutes_limit).
      testingBotApiMock.getUserInfo.mockResolvedValue({
        first_name: "Ada",
        last_name: "Lovelace",
        plan: "Enterprise Plan",
        company: "Analytical Engines",
        country: "GB",
        seconds: 36000,
        max_concurrent: 5,
        max_concurrent_mobile: 2,
      });

      const tools = addUserTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getUserInfo.handler({});

      expect(testingBotApiMock.getUserInfo).toHaveBeenCalled();
      const text = result.content[0].text;
      expect(text).toContain("Ada Lovelace");
      expect(text).toContain("**Plan**: Enterprise Plan");
      expect(text).toContain("**Company**: Analytical Engines");
      expect(text).toContain("**Seconds Available**: 36000");
      expect(text).toContain("**Max Concurrency**: 5");
      expect(text).toContain("**Max Mobile Concurrency**: 2");
      // Regression guard: never render absent fields as the literal "undefined".
      expect(text).not.toContain("undefined");
    });

    it("omits the email line when the API returns no email", async () => {
      testingBotApiMock.getUserInfo.mockResolvedValue({
        first_name: "Ada",
        last_name: "Lovelace",
      });

      const tools = addUserTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getUserInfo.handler({});

      const text = result.content[0].text;
      expect(text).toContain("Ada Lovelace");
      expect(text).not.toContain("Email");
      expect(text).not.toContain("undefined");
    });

    it("renders email only when present", async () => {
      testingBotApiMock.getUserInfo.mockResolvedValue({
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
      });

      const tools = addUserTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getUserInfo.handler({});

      expect(result.content[0].text).toContain("**Email**: ada@example.com");
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
