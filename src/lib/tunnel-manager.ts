import { randomUUID } from "crypto";
import logger from "./logger.js";

// Minimal shape of the testingbot-tunnel-launcher module we use. Typed locally so
// tests can inject a fake without pulling in the real (CommonJS, Java-spawning)
// launcher.
export interface TunnelProcessLike {
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  close(callback?: () => void): void;
}

export interface TunnelLauncherLike {
  downloadAndRunAsync(options: Record<string, unknown>): Promise<TunnelProcessLike>;
}

export interface StartTunnelOptions {
  apiKey: string;
  apiSecret: string;
  tunnelIdentifier?: string;
  shared?: boolean;
  noBump?: boolean;
  noCache?: boolean;
  timeoutSeconds?: number;
}

export interface ManagedTunnel {
  identifier: string;
  startedAt: Date;
  process: TunnelProcessLike;
}

const CLOSE_TIMEOUT_MS = 15_000;

export function generateTunnelIdentifier(): string {
  return `mcp-${randomUUID().slice(0, 8)}`;
}

async function loadLauncher(): Promise<TunnelLauncherLike> {
  // Loaded lazily: the launcher is CommonJS and registers process exit hooks, and
  // most sessions never start a tunnel.
  const mod: any = await import("testingbot-tunnel-launcher");
  return (mod.default ?? mod) as TunnelLauncherLike;
}

function isRunning(proc: TunnelProcessLike): boolean {
  return proc.exitCode === null && proc.signalCode === null;
}

/**
 * Tracks the TestingBot Tunnels this MCP server process started, keyed by
 * tunnel identifier, so they can be stopped by name and are always torn down
 * when the server shuts down.
 */
export class TunnelManager {
  private tunnels = new Map<string, ManagedTunnel>();
  private starting = new Map<string, Promise<ManagedTunnel>>();

  constructor(private readonly load: () => Promise<TunnelLauncherLike> = loadLauncher) {}

  list(): ManagedTunnel[] {
    for (const [id, t] of this.tunnels) {
      if (!isRunning(t.process)) this.tunnels.delete(id);
    }
    return [...this.tunnels.values()];
  }

  get(identifier: string): ManagedTunnel | undefined {
    return this.list().find((t) => t.identifier === identifier);
  }

  /**
   * Start a tunnel, or return the one this process already runs under the same
   * identifier. Resolves once the tunnel reports ready.
   */
  async start(options: StartTunnelOptions): Promise<{ tunnel: ManagedTunnel; reused: boolean }> {
    const identifier = options.tunnelIdentifier?.trim() || generateTunnelIdentifier();

    const existing = this.get(identifier);
    if (existing) return { tunnel: existing, reused: true };

    const pending = this.starting.get(identifier);
    if (pending) return { tunnel: await pending, reused: true };

    const launch = (async () => {
      const launcher = await this.load();
      const launcherOptions: Record<string, unknown> = {
        apiKey: options.apiKey,
        apiSecret: options.apiSecret,
        tunnelIdentifier: identifier,
      };
      if (options.shared) launcherOptions.shared = true;
      if (options.noBump) launcherOptions.noBump = true;
      if (options.noCache) launcherOptions.noCache = true;
      if (options.timeoutSeconds) launcherOptions.timeout = options.timeoutSeconds;

      logger.info({ identifier }, "Starting TestingBot Tunnel");
      const proc = await launcher.downloadAndRunAsync(launcherOptions);
      const tunnel: ManagedTunnel = { identifier, startedAt: new Date(), process: proc };
      this.tunnels.set(identifier, tunnel);
      logger.info({ identifier, pid: proc.pid }, "TestingBot Tunnel ready");
      return tunnel;
    })();

    this.starting.set(identifier, launch);
    try {
      return { tunnel: await launch, reused: false };
    } finally {
      this.starting.delete(identifier);
    }
  }

  /** Stop a tunnel this process started. Returns false if there is none by that identifier. */
  async stop(identifier: string): Promise<boolean> {
    const tunnel = this.tunnels.get(identifier);
    if (!tunnel) return false;
    this.tunnels.delete(identifier);
    if (!isRunning(tunnel.process)) return true;

    logger.info({ identifier }, "Stopping TestingBot Tunnel");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
      tunnel.process.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    return true;
  }

  async stopAll(): Promise<void> {
    // Let in-flight starts settle so a tunnel that becomes ready during shutdown
    // is not left running.
    await Promise.allSettled([...this.starting.values()]);
    await Promise.allSettled([...this.tunnels.keys()].map((id) => this.stop(id)));
  }
}

export const tunnelManager = new TunnelManager();
