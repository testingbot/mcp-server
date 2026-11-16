import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createHostedApp, requiredScope } from "../../src/hosted/http-app.js";
import { HOSTED_TOOLS, hostedToolPolicies } from "../../src/hosted/tool-policy.js";
import { RateLimiter } from "../../src/hosted/rate-limit.js";
import { createBearerApi } from "../../src/hosted/bearer-api.js";
import { Introspector } from "../../src/hosted/introspection.js";

const RESOURCE = "https://mcp.testingbot.com/mcp";
const PRM = "https://mcp.testingbot.com/.well-known/oauth-protected-resource/mcp";
const HOST = "mcp.testingbot.com";

const tokens: Record<string, any> = {
  tbo_at_read: { active: true, sub: "1", client_id: "c1", scope: "mcp:read", aud: RESOURCE },
  tbo_at_write: {
    active: true,
    sub: "1",
    client_id: "c1",
    scope: "mcp:read mcp:write",
    aud: RESOURCE,
  },
  tbo_at_other_aud: {
    active: true,
    sub: "1",
    client_id: "c1",
    scope: "mcp:read",
    aud: "https://evil/mcp",
  },
};

function fakeApi() {
  return {
    getBrowsers: vi.fn().mockResolvedValue([{ name: "chrome", version: "120", platform: "WIN11" }]),
    getTests: vi.fn().mockResolvedValue({ data: [], meta: { offset: 0, count: 0, total: 0 } }),
    stopTest: vi.fn().mockResolvedValue({ success: true }),
  };
}

let api: any;
let apiTokens: Array<string | null>;

function makeApp(extra: Record<string, any> = {}) {
  apiTokens = [];
  return createHostedApp({
    resourceUrl: RESOURCE,
    issuer: "https://testingbot.com",
    apiBase: "https://api.testingbot.com",
    allowedHosts: [HOST],
    introspector: { introspect: async (t: string) => tokens[t] ?? { active: false } },
    apiFactory: (token) => {
      apiTokens.push(token);
      return api;
    },
    ...extra,
  });
}

const rpc = (method: string, params: any = {}, id = 1) => ({ jsonrpc: "2.0", id, method, params });
const call = (name: string, args: any = {}) => rpc("tools/call", { name, arguments: args });

function post(app: any, body: any, token?: string) {
  const r = request(app)
    .post("/mcp")
    .set("Host", HOST)
    .set("Accept", "application/json, text/event-stream")
    .set("Content-Type", "application/json");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

describe("hosted MCP HTTP app", () => {
  beforeEach(() => {
    api = fakeApi();
  });

  it("serves protected resource metadata at both well-known paths", async () => {
    const app = makeApp();
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const res = await request(app).get(path).set("Host", HOST);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        resource: RESOURCE,
        authorization_servers: ["https://testingbot.com"],
        bearer_methods_supported: ["header"],
      });
      expect(res.body.scopes_supported).toContain("offline_access");
    }
  });

  it("answers GET and DELETE /mcp with 405 (stateless, no SSE stream)", async () => {
    const app = makeApp();
    expect((await request(app).get("/mcp").set("Host", HOST)).status).toBe(405);
    expect((await request(app).delete("/mcp").set("Host", HOST)).status).toBe(405);
  });

  it("refuses a foreign Host header", async () => {
    const res = await request(makeApp()).post("/mcp").set("Host", "evil.example").send(rpc("ping"));
    expect(res.status).toBe(421);
  });

  it("lets initialize and tools/list through without a token, with annotations", async () => {
    const app = makeApp();
    const init = await post(
      app,
      rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      })
    );
    expect(init.status).toBe(200);
    expect(init.body.result.instructions.length).toBeGreaterThan(100);
    expect(init.headers["mcp-session-id"]).toBeUndefined();

    const list = await post(app, rpc("tools/list"));
    expect(list.status).toBe(200);
    const names = list.body.result.tools.map((t: any) => t.name);
    expect(names).toContain("getTests");
    expect(names).not.toContain("tb_login");
    expect(names).not.toContain("uploadFile");
    expect(names).not.toContain("startTunnel");
    expect(names).not.toContain("deleteTest");
    const getTests = list.body.result.tools.find((t: any) => t.name === "getTests");
    expect(getTests.annotations.readOnlyHint).toBe(true);
    expect(getTests.inputSchema.type).toBe("object");
    const stop = list.body.result.tools.find((t: any) => t.name === "stopTest");
    expect(stop.annotations.readOnlyHint).toBe(false);
  });

  it("runs a public tool without a token, sending no credentials upstream", async () => {
    const res = await post(makeApp(), call("getBrowsers"));
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBeFalsy();
    expect(apiTokens).toEqual([null]);
  });

  it("answers a protected tools/call without a token with 401 + resource_metadata", async () => {
    const res = await post(makeApp(), call("getTests"));
    expect(res.status).toBe(401);
    const www = res.headers["www-authenticate"];
    expect(www).toContain('error="invalid_token"');
    expect(www).toContain(`resource_metadata="${PRM}"`);
    expect(api.getTests).not.toHaveBeenCalled();
  });

  it("answers an inactive token with 401, even for public calls", async () => {
    expect((await post(makeApp(), call("getTests"), "tbo_at_dead")).status).toBe(401);
    expect((await post(makeApp(), rpc("tools/list"), "tbo_at_dead")).status).toBe(401);
  });

  it("refuses a token issued for another resource", async () => {
    expect((await post(makeApp(), call("getTests"), "tbo_at_other_aud")).status).toBe(401);
  });

  it("runs a read tool with mcp:read and forwards the bearer", async () => {
    const res = await post(makeApp(), call("getTests"), "tbo_at_read");
    expect(res.status).toBe(200);
    expect(api.getTests).toHaveBeenCalled();
    expect(apiTokens).toEqual(["tbo_at_read"]);
  });

  it("steps up a write tool with a read-only token: 403 insufficient_scope", async () => {
    const res = await post(makeApp(), call("stopTest", { sessionId: "abc" }), "tbo_at_read");
    expect(res.status).toBe(403);
    expect(res.headers["www-authenticate"]).toContain('error="insufficient_scope"');
    expect(res.headers["www-authenticate"]).toContain('scope="mcp:read mcp:write"');
    expect(api.stopTest).not.toHaveBeenCalled();
  });

  it("runs a write tool with mcp:write", async () => {
    const res = await post(makeApp(), call("stopTest", { sessionId: "abc" }), "tbo_at_write");
    expect(res.status).toBe(200);
    expect(api.stopTest).toHaveBeenCalled();
  });

  it("checks the strictest scope across a batch", () => {
    const policies = hostedToolPolicies({});
    expect(requiredScope([call("getBrowsers"), call("stopTest")], policies)).toBe("mcp:write");
    expect(requiredScope([rpc("tools/list"), call("getTests")], policies)).toBe("mcp:read");
    expect(requiredScope(call("nope"), policies)).toBe("public");
  });

  it("rate limits per grant", async () => {
    const app = makeApp({ rateLimiter: new RateLimiter(2, 60_000) });
    expect((await post(app, call("getTests"), "tbo_at_read")).status).toBe(200);
    expect((await post(app, call("getTests"), "tbo_at_read")).status).toBe(200);
    const third = await post(app, call("getTests"), "tbo_at_read");
    expect(third.status).toBe(429);
    expect(third.headers["retry-after"]).toBeDefined();
  });

  it("returns 503 when introspection is down (fails closed)", async () => {
    const app = makeApp({
      introspector: {
        introspect: async () => {
          throw new Error("down");
        },
      },
    });
    expect((await post(app, call("getTests"), "tbo_at_read")).status).toBe(503);
  });

  it("refuses a local flowsPath in uploadMaestroFlows", async () => {
    const res = await post(
      makeApp(),
      call("uploadMaestroFlows", { projectId: 1, flowsPath: "/etc" }),
      "tbo_at_write"
    );
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain("not available on the hosted server");
  });

  it("caps tool execution time", async () => {
    api.getTests = vi.fn(() => new Promise(() => {}));
    const res = await post(makeApp({ toolTimeoutMs: 50 }), call("getTests"), "tbo_at_read");
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toMatch(/did not finish/);
  });

  it("offers the delete tools only behind MCP_HOSTED_DESTRUCTIVE_TOOLS=1", () => {
    expect(Object.keys(hostedToolPolicies({}))).not.toContain("deleteTest");
    const p = hostedToolPolicies({ MCP_HOSTED_DESTRUCTIVE_TOOLS: "1" });
    expect(p.deleteTest.destructive).toBe(true);
    expect(Object.values(HOSTED_TOOLS).every((t) => !t.destructive)).toBe(true);
  });
});

describe("bearer API client", () => {
  it("sends Bearer instead of Basic and never reads local credentials", async () => {
    const client = createBearerApi("tbo_at_x", "http://127.0.0.1:9");
    const seen: any[] = [];
    // Replace the network call underneath the patched _send.
    const proto = Object.getPrototypeOf(client);
    const spy = vi.spyOn(proto, "_send").mockImplementation(function (opts: any) {
      seen.push(opts);
      return Promise.resolve({});
    });
    const fresh = createBearerApi("tbo_at_x", "http://127.0.0.1:9");
    await fresh.request({ method: "GET", url: "/tests" });
    spy.mockRestore();
    expect(seen[0].auth).toBeUndefined();
    expect(seen[0].headers.Authorization).toBe("Bearer tbo_at_x");
    expect(seen[0].url).toBe("http://127.0.0.1:9/v1/tests");
    expect(() => fresh.getAuthenticationHashForSharing("s")).toThrow();
  });
});

describe("Introspector", () => {
  it("caches results for 60 s by token digest and fails closed on errors", async () => {
    let now = 0;
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ active: true, scope: "mcp:read", exp: 10_000 }),
    });
    const i = new Introspector({
      url: "http://x/introspect",
      secret: "s",
      fetchImpl: fetchImpl as any,
      now: () => now,
    });
    await i.introspect("t");
    await i.introspect("t");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].headers["X-TB-Introspect-Secret"]).toBe("s");
    now = 61_000;
    await i.introspect("t");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const failing = new Introspector({
      url: "http://x",
      secret: "s",
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any,
    });
    await expect(failing.introspect("t")).rejects.toThrow();
  });
});
