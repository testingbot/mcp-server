import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import { TunnelManager, generateTunnelIdentifier } from "../../src/lib/tunnel-manager.js";

function fakeProcess() {
  const proc: any = new EventEmitter();
  proc.pid = 4242;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.close = vi.fn((cb?: () => void) => {
    proc.signalCode = "SIGINT";
    if (cb) cb();
  });
  return proc;
}

function managerWith(launch = vi.fn(async () => fakeProcess())) {
  const manager = new TunnelManager(async () => ({ downloadAndRunAsync: launch }));
  return { manager, launch };
}

const creds = { apiKey: "key", apiSecret: "secret" };

describe("TunnelManager", () => {
  it("generates mcp- identifiers", () => {
    expect(generateTunnelIdentifier()).toMatch(/^mcp-[0-9a-f]{8}$/);
  });

  it("starts a tunnel with the credentials and identifier", async () => {
    const { manager, launch } = managerWith();
    const { tunnel, reused } = await manager.start({ ...creds, tunnelIdentifier: "t1" });
    expect(reused).toBe(false);
    expect(tunnel.identifier).toBe("t1");
    expect(launch).toHaveBeenCalledWith({ apiKey: "key", apiSecret: "secret", tunnelIdentifier: "t1" });
    expect(manager.list().map((t) => t.identifier)).toEqual(["t1"]);
  });

  it("always gives the tunnel an identifier", async () => {
    const { manager, launch } = managerWith();
    const { tunnel } = await manager.start(creds);
    expect(tunnel.identifier).toMatch(/^mcp-/);
    expect((launch.mock.calls[0] as any)[0].tunnelIdentifier).toBe(tunnel.identifier);
  });

  it("passes optional flags only when set", async () => {
    const { manager, launch } = managerWith();
    await manager.start({ ...creds, tunnelIdentifier: "t", shared: true, noBump: true, noCache: true, timeoutSeconds: 30 });
    expect((launch.mock.calls[0] as any)[0]).toMatchObject({ shared: true, noBump: true, noCache: true, timeout: 30 });
  });

  it("reuses a running tunnel with the same identifier", async () => {
    const { manager, launch } = managerWith();
    await manager.start({ ...creds, tunnelIdentifier: "same" });
    const second = await manager.start({ ...creds, tunnelIdentifier: "same" });
    expect(second.reused).toBe(true);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("shares one launch between concurrent starts", async () => {
    const { manager, launch } = managerWith();
    const [a, b] = await Promise.all([
      manager.start({ ...creds, tunnelIdentifier: "c" }),
      manager.start({ ...creds, tunnelIdentifier: "c" }),
    ]);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(a.tunnel).toBe(b.tunnel);
  });

  it("drops tunnels whose process exited", async () => {
    const { manager } = managerWith();
    const { tunnel } = await manager.start({ ...creds, tunnelIdentifier: "dead" });
    (tunnel.process as any).exitCode = 1;
    expect(manager.list()).toEqual([]);
  });

  it("propagates launch failures and does not track the tunnel", async () => {
    const launch = vi.fn(async () => {
      throw new Error("Java 17 or higher is required");
    });
    const { manager } = managerWith(launch as any);
    await expect(manager.start({ ...creds, tunnelIdentifier: "x" })).rejects.toThrow(/Java/);
    expect(manager.list()).toEqual([]);
  });

  it("stops a tunnel by identifier", async () => {
    const { manager } = managerWith();
    const { tunnel } = await manager.start({ ...creds, tunnelIdentifier: "s" });
    expect(await manager.stop("s")).toBe(true);
    expect(tunnel.process.close).toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
    expect(await manager.stop("s")).toBe(false);
  });

  it("stopAll stops every tunnel", async () => {
    const { manager } = managerWith();
    const a = await manager.start({ ...creds, tunnelIdentifier: "a" });
    const b = await manager.start({ ...creds, tunnelIdentifier: "b" });
    await manager.stopAll();
    expect(a.tunnel.process.close).toHaveBeenCalled();
    expect(b.tunnel.process.close).toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
  });
});
