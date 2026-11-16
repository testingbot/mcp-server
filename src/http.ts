import logger from "./lib/logger.js";
import { createHostedApp } from "./hosted/http-app.js";
import { Introspector } from "./hosted/introspection.js";

// Hosted mode entry: `testingbot-mcp-server --http [--port 3100]`.
// Configuration comes from the environment (set by the systemd unit):
//   MCP_PUBLIC_URL         https://mcp.testingbot.com/mcp (the resource URL)
//   OAUTH_ISSUER           https://testingbot.com
//   TB_API_BASE            https://api.testingbot.com
//   OAUTH_INTROSPECT_URL   Puma's local bind, e.g. http://127.0.0.1:3000/oauth/introspect
//   OAUTH_INTROSPECT_HOST  Host header for that call (testingbot.com)
//   OAUTH_INTROSPECT_SECRET shared secret (oauth.introspect_secret in Rails)
//   MCP_ALLOWED_HOSTS      comma list, default: the host of MCP_PUBLIC_URL
//   MCP_HOSTED_DESTRUCTIVE_TOOLS=1  also offer the delete* tools
export async function startHttp(argv: string[] = process.argv): Promise<void> {
  const portIdx = argv.indexOf("--port");
  const port = Number(portIdx >= 0 ? argv[portIdx + 1] : (process.env.PORT ?? 3100));
  const bind = process.env.MCP_BIND ?? "127.0.0.1";

  const resourceUrl = process.env.MCP_PUBLIC_URL ?? "https://mcp.testingbot.com/mcp";
  const introspectUrl = process.env.OAUTH_INTROSPECT_URL;
  const introspectSecret = process.env.OAUTH_INTROSPECT_SECRET;
  if (!introspectUrl || !introspectSecret) {
    throw new Error(
      "OAUTH_INTROSPECT_URL and OAUTH_INTROSPECT_SECRET are required in --http mode."
    );
  }

  const app = createHostedApp({
    resourceUrl,
    issuer: process.env.OAUTH_ISSUER ?? "https://testingbot.com",
    apiBase: process.env.TB_API_BASE ?? "https://api.testingbot.com",
    introspector: new Introspector({
      url: introspectUrl,
      secret: introspectSecret,
      hostHeader: process.env.OAUTH_INTROSPECT_HOST,
    }),
    allowedHosts: (process.env.MCP_ALLOWED_HOSTS ?? new URL(resourceUrl).hostname)
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
    documentationUrl: "https://testingbot.com/support/ai/mcp/remote",
  });

  const server = app.listen(port, bind, () => {
    logger.info({ port, bind, resourceUrl }, "TestingBot MCP Server listening (hosted HTTP mode)");
  });

  // Drain on SIGTERM: stop accepting, let in-flight calls (max 60 s) finish.
  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down hosted MCP server");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 65_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
