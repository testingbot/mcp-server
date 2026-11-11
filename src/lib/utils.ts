import logger from "./logger.js";

export function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9-_]/g, "");
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function handleMCPError(
  toolName: string,
  error: unknown
): {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
} {
  const errorMessage = formatError(error);
  logger.error({ tool: toolName, error: errorMessage }, "Tool execution failed");

  const readableToolName = toolName
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .trim();

  return {
    content: [
      {
        type: "text",
        text: `Failed to ${readableToolName}: ${errorMessage}. Please check your credentials and try again.`,
      },
    ],
    isError: true,
  };
}

export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// True when a URL points somewhere TestingBot's cloud cannot reach directly:
// localhost, loopback, private/link-local IPv4 ranges, IPv6 loopback/ULA/link-local,
// mDNS/intranet-style suffixes and single-label hostnames. Such URLs only load
// through a TestingBot Tunnel.
export function isPrivateUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/\.(local|internal|lan|home|corp|intranet|test)$/.test(host)) return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  if (host.includes(":")) {
    return host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  }

  // Single-label names ("intranet", "devbox") only resolve on a local network.
  return !host.includes(".");
}

export const PRIVATE_URL_HINT =
  "This URL is on localhost or a private network, which TestingBot's cloud can only reach through a TestingBot Tunnel. Start one with startTunnel (or check getTunnelList).";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
