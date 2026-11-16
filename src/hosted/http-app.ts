import express, { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import logger from "../lib/logger.js";
import { createBearerApi } from "./bearer-api.js";
import { createHostedMcpServer } from "./hosted-server.js";
import { Introspector, TokenInfo, tokenDigest } from "./introspection.js";
import { RateLimiter } from "./rate-limit.js";
import { HostedScope, HostedToolPolicy, hostedToolPolicies } from "./tool-policy.js";

// Hosted MCP resource server (HOSTED_MCP_PLAN.md, WP2).
//
//   POST /mcp      stateless Streamable HTTP, JSON responses only (no
//                  Mcp-Session-Id, no SSE). GET/DELETE /mcp answer 405.
//   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 metadata
//   GET  /healthz
//
// Auth runs BEFORE the SDK: Claude only starts sign-in on a transport-level
// 401, so a protected tools/call without a valid token is answered 401 with
// WWW-Authenticate pointing at the protected resource metadata, and a read-only
// token calling a write tool gets 403 insufficient_scope (step-up). initialize,
// ping, tools/list and the public catalog tools work without a token.
//
// The bearer is forwarded verbatim to the TestingBot API. This process never
// sees an API key or secret.

export interface HostedAppOptions {
  resourceUrl: string; // https://mcp.testingbot.com/mcp
  issuer: string; // https://testingbot.com
  apiBase: string; // https://api.testingbot.com
  introspector: Pick<Introspector, "introspect">;
  allowedHosts: string[]; // Host header allowlist (DNS rebinding)
  documentationUrl?: string;
  rateLimiter?: RateLimiter;
  policies?: Record<string, HostedToolPolicy>;
  toolTimeoutMs?: number;
  // Test seam: build the API client for a token.
  apiFactory?: (token: string | null, apiBase: string) => any;
}

const SCOPE_RANK: Record<HostedScope, number> = { public: 0, "mcp:read": 1, "mcp:write": 2 };
const BODY_LIMIT = "1mb";

type JsonRpcMessage = { jsonrpc?: string; id?: unknown; method?: string; params?: any };

// The scope a JSON-RPC message (or batch) needs. Unknown tools need nothing
// here; the SDK answers them with an error.
export function requiredScope(
  body: unknown,
  policies: Record<string, HostedToolPolicy>
): HostedScope {
  const messages: JsonRpcMessage[] = Array.isArray(body) ? body : [body as JsonRpcMessage];
  let needed: HostedScope = "public";
  for (const m of messages) {
    if (!m || typeof m !== "object" || m.method !== "tools/call") continue;
    const policy = policies[String(m.params?.name ?? "")];
    if (policy && SCOPE_RANK[policy.scope] > SCOPE_RANK[needed]) needed = policy.scope;
  }
  return needed;
}

export function protectedResourceMetadataUrl(resourceUrl: string): string {
  const u = new URL(resourceUrl);
  return `${u.origin}/.well-known/oauth-protected-resource${u.pathname === "/" ? "" : u.pathname}`;
}

export function createHostedApp(opts: HostedAppOptions) {
  const app = express();
  const policies = opts.policies ?? hostedToolPolicies();
  const limiter = opts.rateLimiter ?? new RateLimiter();
  const apiFactory = opts.apiFactory ?? createBearerApi;
  const prmUrl = protectedResourceMetadataUrl(opts.resourceUrl);
  const allowedHosts = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));

  app.disable("x-powered-by");
  // nginx on the same host sets X-Forwarded-*; it is the only proxy hop we trust.
  app.set("trust proxy", "loopback");

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID"
    );
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Host allowlist: a browser tricked by DNS rebinding sends its own Host.
  app.use((req, res, next) => {
    const host = String(req.headers.host ?? "")
      .toLowerCase()
      .replace(/:\d+$/, "");
    if (allowedHosts.size > 0 && !allowedHosts.has(host)) {
      res.status(421).json({ error: "misdirected_request" });
      return;
    }
    next();
  });

  const prm = (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json({
      resource: opts.resourceUrl,
      authorization_servers: [opts.issuer],
      scopes_supported: ["mcp:read", "mcp:write", "offline_access"],
      bearer_methods_supported: ["header"],
      resource_name: "TestingBot",
      ...(opts.documentationUrl && { resource_documentation: opts.documentationUrl }),
    });
  };
  app.get("/.well-known/oauth-protected-resource", prm);
  app.get(`/.well-known/oauth-protected-resource${new URL(opts.resourceUrl).pathname}`, prm);

  const mcpPath = new URL(opts.resourceUrl).pathname || "/mcp";

  app.get(mcpPath, methodNotAllowed);
  app.delete(mcpPath, methodNotAllowed);

  app.post(mcpPath, express.json({ limit: BODY_LIMIT }), async (req: Request, res: Response) => {
    const requestId = crypto.randomUUID();
    const needed = requiredScope(req.body, policies);
    const header = String(req.headers.authorization ?? "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

    let info: TokenInfo | null = null;
    if (token) {
      try {
        info = await opts.introspector.introspect(token);
      } catch (error) {
        logger.error(
          { requestId, error: error instanceof Error ? error.message : String(error) },
          "introspection failed"
        );
        res.status(503).json(rpcError(req.body, -32603, "Authorization server unavailable"));
        return;
      }
      // A token that is dead or meant for another resource is a 401 even for
      // public calls, so the client refreshes instead of carrying it around.
      if (!info.active || info.aud !== opts.resourceUrl) {
        unauthorized(res, "invalid_token", "The access token is invalid or expired.");
        return;
      }
    } else if (header) {
      unauthorized(res, "invalid_request", "Use a Bearer token.");
      return;
    }

    if (needed !== "public") {
      if (!info) {
        unauthorized(res, "invalid_token", "Sign in to TestingBot to use this tool.");
        return;
      }
      const scopes = String(info.scope ?? "").split(/\s+/);
      if (!scopes.includes(needed)) {
        res.setHeader(
          "WWW-Authenticate",
          `Bearer error="insufficient_scope", scope="mcp:read mcp:write", resource_metadata="${prmUrl}"`
        );
        res
          .status(403)
          .json(rpcError(req.body, -32003, "This tool needs write access (mcp:write)."));
        return;
      }
    }

    const tokenPrefix = token ? tokenDigest(token).slice(0, 12) : null;
    if (info && needed !== "public") {
      const bucket = `${info.sub}:${info.client_id}`;
      if (!limiter.take(bucket)) {
        res.setHeader("Retry-After", "30");
        res.status(429).json(rpcError(req.body, -32029, "Too many tool calls; slow down."));
        return;
      }
    }

    const api = apiFactory(info ? token : null, opts.apiBase);
    const server = createHostedMcpServer({
      api,
      config: {
        "testingbot-key": "",
        "testingbot-secret": "",
        "testingbot-bearer": info ? (token ?? undefined) : undefined,
        "api-base": opts.apiBase,
      },
      policies,
      timeoutMs: opts.toolTimeoutMs,
      onToolCall: (tool, ms, isError) =>
        logger.info(
          {
            requestId,
            tool,
            ms,
            isError,
            token: tokenPrefix,
            user: info?.sub,
            client: info?.client_id,
          },
          "tool call"
        ),
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    const first = (Array.isArray(req.body) ? req.body[0] : req.body) as JsonRpcMessage | undefined;
    if (first?.method === "initialize") {
      logger.info(
        {
          requestId,
          clientInfo: first.params?.clientInfo,
          protocolVersion: first.params?.protocolVersion,
        },
        "initialize"
      );
    }

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error(
        { requestId, error: error instanceof Error ? error.message : String(error) },
        "mcp request failed"
      );
      if (!res.headersSent) res.status(500).json(rpcError(req.body, -32603, "Internal error"));
    }
  });

  // Malformed JSON from express.json.
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err?.type === "entity.parse.failed") {
      res
        .status(400)
        .json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    if (err?.type === "entity.too.large") {
      res
        .status(413)
        .json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } });
      return;
    }
    next(err);
  });

  function unauthorized(res: Response, error: string, description: string) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer error="${error}", error_description="${description}", resource_metadata="${prmUrl}", scope="mcp:read"`
    );
    res.status(401).json({ error, error_description: description });
  }

  return app;
}

function methodNotAllowed(_req: Request, res: Response) {
  res.setHeader("Allow", "POST, OPTIONS");
  res
    .status(405)
    .json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method not allowed." } });
}

function rpcError(body: unknown, code: number, message: string) {
  const id =
    !Array.isArray(body) && body && typeof body === "object" ? ((body as any).id ?? null) : null;
  return { jsonrpc: "2.0", id, error: { code, message } };
}
