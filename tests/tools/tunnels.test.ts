import { describe, it, expect, vi, beforeEach } from "vitest";
import addTunnelTools from "../../src/tools/tunnels.js";
import { TunnelManager } from "../../src/lib/tunnel-manager.js";

describe("Tunnel Tools", () => {
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
      getTunnelList: vi.fn(),
      deleteTunnel: vi.fn(),
    };

    configMock = {
      "testingbot-key": "test-key",
      "testingbot-secret": "test-secret",
    };
  });

  describe("getTunnelList", () => {
    it("should fetch and format tunnel list", async () => {
      const mockTunnels = [
        {
          id: "tunnel-123",
          status: "active",
          version: "1.0.0",
          created_at: "2025-01-01T00:00:00Z",
          ip: "192.168.1.100",
          last_heartbeat: "2025-01-01T12:00:00Z",
        },
        {
          id: "tunnel-456",
          status: "active",
          version: "1.0.0",
          created_at: "2025-01-02T00:00:00Z",
          ip: "192.168.1.101",
          last_heartbeat: "2025-01-02T12:00:00Z",
        },
      ];

      testingBotApiMock.getTunnelList.mockResolvedValue(mockTunnels);

      const tools = addTunnelTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTunnelList.handler({});

      expect(testingBotApiMock.getTunnelList).toHaveBeenCalled();
      expect(result.content[0].text).toContain("tunnel-123");
      expect(result.content[0].text).toContain("tunnel-456");
      expect(result.content[0].text).toContain("active");
      expect(result.content[0].text).toContain("192.168.1.100");
      expect(result.content[0].text).toContain("**Total**: 2 active tunnels");
    });

    it("should show single tunnel count correctly", async () => {
      const mockTunnels = [
        {
          id: "tunnel-single",
          status: "active",
          version: "1.0.0",
        },
      ];

      testingBotApiMock.getTunnelList.mockResolvedValue(mockTunnels);

      const tools = addTunnelTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTunnelList.handler({});

      expect(result.content[0].text).toContain("**Total**: 1 active tunnel");
      expect(result.content[0].text).not.toContain("2 active tunnels");
    });

    it("should handle empty tunnel list", async () => {
      testingBotApiMock.getTunnelList.mockResolvedValue([]);

      const tools = addTunnelTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTunnelList.handler({});

      expect(result.content[0].text).toContain("No active tunnels found");
      expect(result.content[0].text).toContain("https://testingbot.com/support/other/tunnel");
    });

    it("should display all tunnel properties when available", async () => {
      const mockTunnels = [
        {
          id: "tunnel-full",
          status: "running",
          version: "2.5.3",
          created_at: "2025-01-15T10:30:00Z",
          ip: "10.0.0.1",
          last_heartbeat: "2025-01-15T14:45:00Z",
        },
      ];

      testingBotApiMock.getTunnelList.mockResolvedValue(mockTunnels);

      const tools = addTunnelTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTunnelList.handler({});

      expect(result.content[0].text).toContain("tunnel-full");
      expect(result.content[0].text).toContain("running");
      expect(result.content[0].text).toContain("2.5.3");
      expect(result.content[0].text).toContain("2025-01-15T10:30:00Z");
      expect(result.content[0].text).toContain("10.0.0.1");
      expect(result.content[0].text).toContain("2025-01-15T14:45:00Z");
    });

    it("should handle tunnels with minimal information", async () => {
      const mockTunnels = [
        {
          id: "tunnel-minimal",
        },
      ];

      testingBotApiMock.getTunnelList.mockResolvedValue(mockTunnels);

      const tools = addTunnelTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTunnelList.handler({});

      expect(result.content[0].text).toContain("tunnel-minimal");
      expect(result.content[0].text).toContain("Tunnel tunnel-minimal");
    });

    it("should handle API errors", async () => {
      testingBotApiMock.getTunnelList.mockRejectedValue(new Error("API Error"));

      const tools = addTunnelTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTunnelList.handler({});

      expect(result.isError).toBe(true);
    });

    it("should handle non-array response", async () => {
      testingBotApiMock.getTunnelList.mockResolvedValue(null);

      const tools = addTunnelTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getTunnelList.handler({});

      expect(result.content[0].text).toContain("No active tunnels found");
    });
  });

  describe("deleteTunnel", () => {
    it("should delete tunnel with numeric ID", async () => {
      testingBotApiMock.deleteTunnel.mockResolvedValue({ success: true });

      const tools = addTunnelTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.deleteTunnel.handler({ tunnelId: 123 });

      expect(testingBotApiMock.deleteTunnel).toHaveBeenCalledWith(123);
      expect(result.content[0].text).toContain("Tunnel 123 deleted successfully");
    });

    it("should delete tunnel with string ID", async () => {
      testingBotApiMock.deleteTunnel.mockResolvedValue({ success: true });

      const tools = addTunnelTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.deleteTunnel.handler({ tunnelId: "tunnel-abc-123" });

      expect(testingBotApiMock.deleteTunnel).toHaveBeenCalledWith("tunnel-abc-123");
      expect(result.content[0].text).toContain("Tunnel tunnel-abc-123 deleted successfully");
    });

    it("should handle deletion errors", async () => {
      testingBotApiMock.deleteTunnel.mockRejectedValue(new Error("Tunnel not found"));

      const tools = addTunnelTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.deleteTunnel.handler({ tunnelId: "nonexistent" });

      expect(result.isError).toBe(true);
    });

    it("should handle various ID formats", async () => {
      const idFormats = [
        123,
        "tunnel-123",
        "abc-def-ghi",
        "12345",
      ];

      for (const tunnelId of idFormats) {
        testingBotApiMock.deleteTunnel.mockResolvedValue({ success: true });

        const tools = addTunnelTools(serverMock, testingBotApiMock, configMock);
        const result = await tools.deleteTunnel.handler({ tunnelId });

        expect(testingBotApiMock.deleteTunnel).toHaveBeenCalledWith(tunnelId);
        expect(result.content[0].text).toContain(`Tunnel ${tunnelId} deleted successfully`);
      }
    });
  });

  describe("startTunnel / stopTunnel", () => {
    function fakeProcess() {
      return {
        pid: 1,
        exitCode: null as number | null,
        signalCode: null as string | null,
        close: vi.fn(function (this: any, cb?: () => void) {
          this.signalCode = "SIGINT";
          cb?.();
        }),
      };
    }

    function setup(launch: any = vi.fn(async () => fakeProcess())) {
      const manager = new TunnelManager(async () => ({ downloadAndRunAsync: launch }));
      const tools = addTunnelTools(serverMock, testingBotApiMock, configMock, manager);
      return { tools, manager, launch };
    }

    it("starts a tunnel with the configured credentials and explains how to use it", async () => {
      testingBotApiMock.getTunnelList.mockResolvedValue([{ id: 77, identifier: "dev" }]);
      const { tools, launch } = setup();

      const result = await tools.startTunnel.handler({ tunnelIdentifier: "dev" });

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "test-key", apiSecret: "test-secret", tunnelIdentifier: "dev" })
      );
      const text = result.content[0].text;
      expect(result.isError).toBeUndefined();
      expect(text).toContain("Tunnel started");
      expect(text).toContain("`dev`");
      expect(text).toContain("**Tunnel ID**: 77");
      expect(text).toContain('tunnelIdentifier: "dev"');
      expect(text).toContain("tunnelId: 77");
    });

    it("still succeeds when the tunnel ID lookup fails", async () => {
      testingBotApiMock.getTunnelList.mockRejectedValue(new Error("down"));
      const { tools } = setup();
      const result = await tools.startTunnel.handler({ tunnelIdentifier: "dev" });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).not.toContain("Tunnel ID");
    });

    it("reports a running tunnel instead of starting a second one", async () => {
      testingBotApiMock.getTunnelList.mockResolvedValue([]);
      const { tools, launch } = setup();
      await tools.startTunnel.handler({ tunnelIdentifier: "dev" });
      const result = await tools.startTunnel.handler({ tunnelIdentifier: "dev" });
      expect(launch).toHaveBeenCalledTimes(1);
      expect(result.content[0].text).toContain("already running");
    });

    it("adds a Java hint when the launcher fails on Java", async () => {
      const { tools } = setup(vi.fn(async () => {
        throw new Error("Java is not installed");
      }));
      const result = await tools.startTunnel.handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Java 17");
    });

    it("stops the only running tunnel without an identifier", async () => {
      testingBotApiMock.getTunnelList.mockResolvedValue([]);
      const { tools, manager } = setup();
      await tools.startTunnel.handler({ tunnelIdentifier: "only" });
      const result = await tools.stopTunnel.handler({});
      expect(result.content[0].text).toContain("Tunnel `only` stopped");
      expect(manager.list()).toEqual([]);
    });

    it("asks which tunnel to stop when several run", async () => {
      testingBotApiMock.getTunnelList.mockResolvedValue([]);
      const { tools, manager } = setup();
      await tools.startTunnel.handler({ tunnelIdentifier: "a" });
      await tools.startTunnel.handler({ tunnelIdentifier: "b" });
      const result = await tools.stopTunnel.handler({});
      expect(result.isError).toBe(true);
      expect(manager.list()).toHaveLength(2);

      const all = await tools.stopTunnel.handler({ all: true });
      expect(all.content[0].text).toContain("`a` stopped");
      expect(all.content[0].text).toContain("`b` stopped");
    });

    it("points to deleteTunnel for tunnels it did not start", async () => {
      const { tools } = setup();
      const none = await tools.stopTunnel.handler({});
      expect(none.content[0].text).toContain("deleteTunnel");
      const unknown = await tools.stopTunnel.handler({ tunnelIdentifier: "elsewhere" });
      expect(unknown.content[0].text).toContain("deleteTunnel");
    });

    it("getTunnelList shows identifiers and marks tunnels started here", async () => {
      const { tools, manager } = setup();
      testingBotApiMock.getTunnelList.mockResolvedValue([]);
      await manager.start({ apiKey: "k", apiSecret: "s", tunnelIdentifier: "mine" });
      testingBotApiMock.getTunnelList.mockResolvedValue([
        { id: 1, identifier: "mine", state: "READY" },
        { id: 2, identifier: "theirs", state: "READY" },
      ]);
      const text = (await tools.getTunnelList.handler({})).content[0].text;
      expect(text).toContain("`mine` (started by this MCP server)");
      expect(text).toContain("`theirs`");
      expect(text).not.toContain("`theirs` (started");
      expect(text).toContain("**Status**: READY");
    });
  });
});
