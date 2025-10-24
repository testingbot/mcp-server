import { describe, it, expect, vi, beforeEach } from "vitest";
import addTeamTools from "../../src/tools/team.js";

describe("Team Tools", () => {
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
      getTeam: vi.fn(),
      getUsersInTeam: vi.fn(),
      getUserFromTeam: vi.fn(),
    };

    configMock = {
      "testingbot-key": "test-key",
      "testingbot-secret": "test-secret",
    };
  });

  describe("getTeam", () => {
    it("should fetch and format team settings", async () => {
      const mockTeam = {
        name: "Acme Corp",
        plan: "Enterprise",
        users: 10,
        parallel_tests: 5,
        max_parallel: 10,
        created_at: "2025-01-01T00:00:00Z",
        concurrency: {
          allowed: {
            vms: 2,
            physical: 2,
          },
          current: {
            vms: 0,
            physical: 0,
          },
        },
      };

      testingBotApiMock.getTeam.mockResolvedValue(mockTeam);

      const tools = addTeamTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTeam.handler({});

      expect(testingBotApiMock.getTeam).toHaveBeenCalled();
      expect(result.content[0].text).toContain("Acme Corp");
      expect(result.content[0].text).toContain("Enterprise");
      expect(result.content[0].text).toContain("**Users**: 10");
      expect(result.content[0].text).toContain("**Parallel Tests**: 5");
      expect(result.content[0].text).toContain("Concurrency");
      expect(result.content[0].text).toContain("VMs: 2");
      expect(result.content[0].text).toContain("Physical: 2");
    });

    it("should handle API errors", async () => {
      testingBotApiMock.getTeam.mockRejectedValue(new Error("API Error"));

      const tools = addTeamTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTeam.handler({});

      expect(result.isError).toBe(true);
    });
  });

  describe("getUsersInTeam", () => {
    it("should fetch and format team users", async () => {
      const mockUsers = [
        {
          id: 1,
          email: "john@example.com",
          first_name: "John",
          last_name: "Doe",
          plan: "Enterprise",
          roles: ["admin"],
          read_only: false,
          max_concurrent: 5,
          max_concurrent_mobile: 3,
          seconds: 6000,
          last_login: "2025-01-15T10:00:00Z",
          current_vm_concurrency: 2,
          current_physical_concurrency: 0,
        },
        {
          id: 2,
          email: "jane@example.com",
          first_name: "Jane",
          last_name: "Smith",
          plan: "Free Trial",
          roles: [],
          read_only: true,
          max_concurrent: 1,
          max_concurrent_mobile: 2,
          seconds: 3600,
          last_login: "2025-01-14T09:00:00Z",
          current_vm_concurrency: 0,
          current_physical_concurrency: 0,
        },
      ];

      testingBotApiMock.getUsersInTeam.mockResolvedValue(mockUsers);

      const tools = addTeamTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getUsersInTeam.handler({});

      expect(testingBotApiMock.getUsersInTeam).toHaveBeenCalled();
      expect(result.content[0].text).toContain("John Doe");
      expect(result.content[0].text).toContain("jane@example.com");
      expect(result.content[0].text).toContain("Enterprise");
      expect(result.content[0].text).toContain("Free Trial");
      expect(result.content[0].text).toContain("**Max Concurrent**: 5");
      expect(result.content[0].text).toContain("**Read Only**: Yes");
    });

    it("should handle empty user list", async () => {
      testingBotApiMock.getUsersInTeam.mockResolvedValue([]);

      const tools = addTeamTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getUsersInTeam.handler({});

      expect(result.content[0].text).toContain("No users found in team");
    });

    it("should handle API errors", async () => {
      testingBotApiMock.getUsersInTeam.mockRejectedValue(new Error("API Error"));

      const tools = addTeamTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getUsersInTeam.handler({});

      expect(result.isError).toBe(true);
    });
  });

  describe("getUserFromTeam", () => {
    it("should fetch and format specific user details", async () => {
      const mockUser = {
        id: 1,
        email: "john@example.com",
        first_name: "John",
        last_name: "Doe",
        role: "admin",
        active: true,
        created_at: "2025-01-01T00:00:00Z",
        last_login: "2025-01-15T10:30:00Z",
      };

      testingBotApiMock.getUserFromTeam.mockResolvedValue(mockUser);

      const tools = addTeamTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getUserFromTeam.handler({ userId: 1 });

      expect(testingBotApiMock.getUserFromTeam).toHaveBeenCalledWith(1);
      expect(result.content[0].text).toContain("John Doe");
      expect(result.content[0].text).toContain("john@example.com");
      expect(result.content[0].text).toContain("admin");
      expect(result.content[0].text).toContain("Last Login");
    });

    it("should handle string userId conversion", async () => {
      const mockUser = {
        id: 123,
        email: "test@example.com",
        first_name: "Test",
        last_name: "User",
        role: "member",
        active: true,
      };

      testingBotApiMock.getUserFromTeam.mockResolvedValue(mockUser);

      const tools = addTeamTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getUserFromTeam.handler({ userId: "123" as any });

      expect(testingBotApiMock.getUserFromTeam).toHaveBeenCalledWith(123);
      expect(result.content[0].text).toContain("Test User");
    });

    it("should handle API errors", async () => {
      testingBotApiMock.getUserFromTeam.mockRejectedValue(new Error("User not found"));

      const tools = addTeamTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getUserFromTeam.handler({ userId: 999 });

      expect(result.isError).toBe(true);
    });
  });
});
