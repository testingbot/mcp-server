import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import addAuthTools, { pollDeviceToken } from "../../src/tools/auth.js";

function okResp(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function errResp(error: string, status = 400): Response {
  return { ok: false, status, json: async () => ({ error }) } as unknown as Response;
}

const CREDS = {
  client_key: "newkey",
  client_secret: "newsecret",
  user: { email: "ada@example.com", id: 1 },
};

const CODE = {
  device_code: "DEVICE-CODE",
  user_code: "BCDF-GHJK",
  verification_uri: "https://testingbot.com/device",
  verification_uri_complete: "https://testingbot.com/device?code=BCDF-GHJK",
  expires_in: 900,
  interval: 5,
};

// ---------------------------------------------------------------------------
// pollDeviceToken — pure polling loop with an injected clock + fetch
// ---------------------------------------------------------------------------

describe("pollDeviceToken", () => {
  const future = () => Date.now() + 60_000;

  it("returns approved when the token endpoint returns 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResp(CREDS));
    const res = await pollDeviceToken("http://x", "dc", future(), 10, {
      fetchImpl,
      sleep: vi.fn(),
    });
    expect(res).toEqual({ status: "approved", creds: CREDS });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps polling through authorization_pending, then resolves", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errResp("authorization_pending"))
      .mockResolvedValueOnce(errResp("authorization_pending"))
      .mockResolvedValueOnce(errResp("authorization_pending"))
      .mockResolvedValueOnce(okResp(CREDS));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const res = await pollDeviceToken("http://x", "dc", future(), 10, { fetchImpl, sleep });

    expect(res.status).toBe("approved");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("bumps the interval by 5s on slow_down", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errResp("slow_down"))
      .mockResolvedValueOnce(okResp(CREDS));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await pollDeviceToken("http://x", "dc", future(), 5000, { fetchImpl, sleep });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10000); // 5000 + 5000 increment
  });

  it("returns denied on access_denied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errResp("access_denied"));
    const res = await pollDeviceToken("http://x", "dc", future(), 10, {
      fetchImpl,
      sleep: vi.fn(),
    });
    expect(res).toEqual({ status: "denied" });
  });

  it("returns expired on expired_token and invalid_grant", async () => {
    for (const code of ["expired_token", "invalid_grant"]) {
      const fetchImpl = vi.fn().mockResolvedValue(errResp(code));
      const res = await pollDeviceToken("http://x", "dc", future(), 10, {
        fetchImpl,
        sleep: vi.fn(),
      });
      expect(res).toEqual({ status: "expired" });
    }
  });

  it("returns pending once the deadline passes without approval", async () => {
    let t = 0;
    const now = () => t;
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });
    const fetchImpl = vi.fn().mockResolvedValue(errResp("authorization_pending"));

    const res = await pollDeviceToken("http://x", "dc", 25, 10, { fetchImpl, sleep, now });

    expect(res).toEqual({ status: "pending", intervalMs: 10 });
    // polls at t=0,10,20 then at t=30 the deadline (25) is reached → 4 polls.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("throws on an unexpected error code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errResp("kaboom", 500));
    await expect(
      pollDeviceToken("http://x", "dc", future(), 10, { fetchImpl, sleep: vi.fn() })
    ).rejects.toThrow(/Unexpected response/);
  });

  it("POSTs the device_code in the token request body (RFC 8628 wire contract)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResp(CREDS));
    await pollDeviceToken("http://x", "the-code", future(), 10, { fetchImpl, sleep: vi.fn() });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://x/mcp/oauth/device/token");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body).device_code).toBe("the-code");
  });

  it("throws a clear error on an unreadable 200 body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    } as unknown as Response);
    await expect(
      pollDeviceToken("http://x", "dc", future(), 10, { fetchImpl, sleep: vi.fn() })
    ).rejects.toThrow(/unreadable success response/);
  });

  it("throws when a 200 body is missing credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResp({ user: {} }));
    await expect(
      pollDeviceToken("http://x", "dc", future(), 10, { fetchImpl, sleep: vi.fn() })
    ).rejects.toThrow(/missing credentials/);
  });

  it("returns pending without spinning when the deadline is non-finite", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errResp("authorization_pending"));
    const sleep = vi.fn();
    const res = await pollDeviceToken("http://x", "dc", NaN, 10, { fetchImpl, sleep });
    expect(res.status).toBe("pending");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// tb_login tool — resumable device-auth handler
// ---------------------------------------------------------------------------

describe("tb_login tool", () => {
  let serverMock: any;
  let testingBotApiMock: any;
  let configMock: any;
  let fetchSpy: any;
  let tmpDir: string;
  let savedEnv: Record<string, string | undefined>;

  const ENV_KEYS = [
    "TESTINGBOT_CONFIG_DIR",
    "TESTINGBOT_PROFILE",
    "TESTINGBOT_DEVICE_POLL_WINDOW_MS",
    "TESTINGBOT_BASE_URL",
    "TESTINGBOT_AUTH_MODE",
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => ({ name, desc, schema, handler })),
    };
    testingBotApiMock = { options: { api_key: "", api_secret: "" } };
    configMock = { "testingbot-key": "", "testingbot-secret": "" };

    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-mcp-auth-"));
    process.env.TESTINGBOT_CONFIG_DIR = tmpDir;
    delete process.env.TESTINGBOT_PROFILE;
    delete process.env.TESTINGBOT_DEVICE_POLL_WINDOW_MS;
    delete process.env.TESTINGBOT_BASE_URL;
    // This block exercises the device-code (RFC 8628) path specifically.
    process.env.TESTINGBOT_AUTH_MODE = "device";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Routes /device/code → CODE and /device/token → tokenResponder().
  function stubFetch(tokenResponder: () => Response) {
    fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/mcp/oauth/device/code")) return okResp(CODE);
      if (url.endsWith("/mcp/oauth/device/token")) return tokenResponder();
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
  }

  it("first call returns the URL + user code and does not poll for a token", async () => {
    stubFetch(() => okResp(CREDS));

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock);
    const res = await tools.tb_login.handler({});

    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("BCDF-GHJK");
    expect(res.content[0].text).toContain("https://testingbot.com/device");
    expect(res.content[0].text).toContain("again"); // "run tb_login again"
    // Only /device/code was called — no token poll on the first call.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain("/device/code");
    // No credentials persisted yet.
    expect(fs.existsSync(path.join(tmpDir, "credentials"))).toBe(false);
  });

  it("completes on re-call: writes creds 0600 and updates the live client + config", async () => {
    stubFetch(() => okResp(CREDS));

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock);
    await tools.tb_login.handler({}); // start
    const res = await tools.tb_login.handler({}); // resume → approved

    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("Logged in as ada@example.com");

    const credPath = path.join(tmpDir, "credentials");
    expect(fs.existsSync(credPath)).toBe(true);
    expect(fs.statSync(credPath).mode & 0o777).toBe(0o600);

    // Live, no-restart credential update.
    expect(testingBotApiMock.options.api_key).toBe("newkey");
    expect(testingBotApiMock.options.api_secret).toBe("newsecret");
    expect(configMock["testingbot-key"]).toBe("newkey");
    expect(configMock["testingbot-secret"]).toBe("newsecret");
  });

  it("re-surfaces the code (not an error) when still pending after the poll window", async () => {
    process.env.TESTINGBOT_DEVICE_POLL_WINDOW_MS = "0";
    stubFetch(() => errResp("authorization_pending"));

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock);
    await tools.tb_login.handler({}); // start
    const res = await tools.tb_login.handler({}); // resume → still pending

    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("Still waiting");
    expect(res.content[0].text).toContain("BCDF-GHJK");
    expect(fs.existsSync(path.join(tmpDir, "credentials"))).toBe(false);
  });

  it("returns an error when the user denies authorization", async () => {
    stubFetch(() => errResp("access_denied"));

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock);
    await tools.tb_login.handler({}); // start
    const res = await tools.tb_login.handler({}); // resume → denied

    expect(res.isError).toBe(true);
    expect(res.content[0].text.toLowerCase()).toContain("denied");
  });

  it("returns an error when the code has expired", async () => {
    stubFetch(() => errResp("expired_token"));

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock);
    await tools.tb_login.handler({}); // start
    const res = await tools.tb_login.handler({}); // resume → expired

    expect(res.isError).toBe(true);
    expect(res.content[0].text.toLowerCase()).toContain("expired");
  });

  it("returns an error when starting the flow fails", async () => {
    fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/mcp/oauth/device/code")) {
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      }
      throw new Error("token should not be polled");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock);
    const res = await tools.tb_login.handler({});

    expect(res.isError).toBe(true);
  });

  it("resume polls the exact device_code returned by /device/code", async () => {
    stubFetch(() => okResp(CREDS));

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock);
    await tools.tb_login.handler({}); // start
    await tools.tb_login.handler({}); // resume → approved

    // Resume must reuse the started flow, not restart it: /device/code is hit once.
    const codeCalls = fetchSpy.mock.calls.filter((c: any[]) =>
      c[0].endsWith("/mcp/oauth/device/code")
    );
    expect(codeCalls.length).toBe(1);

    const tokenCall = fetchSpy.mock.calls.find((c: any[]) =>
      c[0].endsWith("/mcp/oauth/device/token")
    );
    expect(tokenCall).toBeDefined();
    expect(JSON.parse(tokenCall[1].body).device_code).toBe(CODE.device_code);
  });

  it("starts a fresh flow (re-hits /device/code) when the previous one has expired", async () => {
    fetchSpy = vi.fn(async (url: string) => {
      // expires_in 0.03s → the flow lapses ~30ms after it starts.
      if (url.endsWith("/mcp/oauth/device/code")) return okResp({ ...CODE, expires_in: 0.03 });
      if (url.endsWith("/mcp/oauth/device/token")) return okResp(CREDS);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock);
    await tools.tb_login.handler({}); // start
    await new Promise((r) => setTimeout(r, 60)); // let the flow expire
    const res = await tools.tb_login.handler({}); // expired → restart, must NOT poll

    const codeCalls = fetchSpy.mock.calls.filter((c: any[]) =>
      c[0].endsWith("/mcp/oauth/device/code")
    );
    const tokenCalls = fetchSpy.mock.calls.filter((c: any[]) =>
      c[0].endsWith("/mcp/oauth/device/token")
    );
    expect(codeCalls.length).toBe(2);
    expect(tokenCalls.length).toBe(0);
    expect(res.content[0].text).toContain("BCDF-GHJK");
  });

  it("honors TESTINGBOT_BASE_URL for the device endpoints", async () => {
    process.env.TESTINGBOT_BASE_URL = "https://staging.example.com";
    stubFetch(() => okResp(CREDS));

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock);
    await tools.tb_login.handler({});

    expect(fetchSpy.mock.calls[0][0]).toBe("https://staging.example.com/mcp/oauth/device/code");
  });

  it("refreshes credential-dependent tools after a successful login", async () => {
    stubFetch(() => okResp(CREDS));
    serverMock.reinitializeAfterLogin = vi.fn().mockResolvedValue(undefined);

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock);
    await tools.tb_login.handler({}); // start
    await tools.tb_login.handler({}); // resume → approved → refresh

    expect(serverMock.reinitializeAfterLogin).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// tb_login tool — loopback (RFC 8252) flow + mode selection
// ---------------------------------------------------------------------------

describe("tb_login loopback flow", () => {
  let serverMock: any;
  let testingBotApiMock: any;
  let configMock: any;
  let tmpDir: string;
  let savedEnv: Record<string, string | undefined>;

  const ENV_KEYS = [
    "TESTINGBOT_CONFIG_DIR",
    "TESTINGBOT_BASE_URL",
    "TESTINGBOT_AUTH_MODE",
    "TESTINGBOT_LOOPBACK_WAIT_MS",
    "TESTINGBOT_LOOPBACK_LIFETIME_MS",
    "SSH_CONNECTION",
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => ({ name, desc, schema, handler })),
    };
    testingBotApiMock = {
      options: { api_key: "", api_secret: "" },
      getUserInfo: vi.fn().mockResolvedValue({ email: "ada@example.com" }),
    };
    configMock = { "testingbot-key": "", "testingbot-secret": "" };

    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-mcp-loopback-"));
    process.env.TESTINGBOT_CONFIG_DIR = tmpDir;
    delete process.env.TESTINGBOT_BASE_URL;
    delete process.env.TESTINGBOT_LOOPBACK_WAIT_MS;
    delete process.env.SSH_CONNECTION;
    process.env.TESTINGBOT_AUTH_MODE = "loopback";
    // Short listener lifetime so any test that doesn't fire a callback doesn't
    // leave a socket open (the lifetime timer is unref'd in the impl).
    process.env.TESTINGBOT_LOOPBACK_LIFETIME_MS = "1000";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Build the loopback callback URL the way the Rails redirect would, echoing the
  // per-flow state token the listener now requires.
  function callbackUrlFrom(authUrl: string, query: string): string {
    const u = new URL(authUrl);
    const port = u.searchParams.get("port");
    const state = u.searchParams.get("state") as string;
    return `http://127.0.0.1:${port}/callback?state=${encodeURIComponent(state)}&${query}`;
  }

  it("completes when the browser hits the loopback callback with credentials", async () => {
    // The injected openBrowser plays the user's browser: it calls the local
    // /callback with state+key+secret, exactly as the Rails authorize redirect would.
    const openBrowser = (url: string) => {
      void fetch(callbackUrlFrom(url, "key=lk&secret=ls")).catch(() => {});
    };

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, { openBrowser });
    const res = await tools.tb_login.handler({});

    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("Logged in as ada@example.com");

    const credPath = path.join(tmpDir, "credentials");
    expect(fs.existsSync(credPath)).toBe(true);
    expect(testingBotApiMock.options.api_key).toBe("lk");
    expect(testingBotApiMock.options.api_secret).toBe("ls");
    expect(configMock["testingbot-key"]).toBe("lk");
    expect(testingBotApiMock.getUserInfo).toHaveBeenCalled();
  });

  it("opens the browser to /auth with the loopback port, mcp identifier, and a state token", async () => {
    let openedUrl = "";
    const openBrowser = (url: string) => {
      openedUrl = url;
      void fetch(callbackUrlFrom(url, "key=lk&secret=ls")).catch(() => {});
    };

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, { openBrowser });
    await tools.tb_login.handler({});

    expect(openedUrl).toContain("https://testingbot.com/auth?port=");
    expect(openedUrl).toContain("identifier=testingbot-mcp");
    expect(new URL(openedUrl).searchParams.get("state")).toBeTruthy();
  });

  it("ignores a callback with a wrong/missing state (CSRF guard) and stays pending", async () => {
    process.env.TESTINGBOT_LOOPBACK_WAIT_MS = "0";
    let authUrl = "";
    const openBrowser = (url: string) => {
      authUrl = url;
    };

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, { openBrowser });
    const first = await tools.tb_login.handler({});
    expect(first.content[0].text).toContain("Opened your browser");

    // Attacker injection: right port, wrong state.
    const u = new URL(authUrl);
    await fetch(
      `http://127.0.0.1:${u.searchParams.get("port")}/callback?state=WRONG&key=evil&secret=evil`
    ).catch(() => {});
    await new Promise((r) => setTimeout(r, 20));

    const second = await tools.tb_login.handler({});
    expect(second.content[0].text).toContain("Opened your browser"); // still pending, not logged in
    expect(configMock["testingbot-key"]).toBe(""); // attacker creds rejected

    // The genuine callback (correct state) then completes the flow.
    await fetch(callbackUrlFrom(authUrl, "key=lk&secret=ls")).catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    const third = await tools.tb_login.handler({});
    expect(third.content[0].text).toContain("Logged in as ada@example.com");
    expect(configMock["testingbot-key"]).toBe("lk");
  });

  it("returns an error when the browser callback reports denial", async () => {
    const openBrowser = (url: string) => {
      void fetch(callbackUrlFrom(url, "error=denied")).catch(() => {});
    };

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, { openBrowser });
    const res = await tools.tb_login.handler({});

    expect(res.isError).toBe(true);
    expect(res.content[0].text.toLowerCase()).toContain("denied");
  });

  it("writes creds even if getUserInfo fails (email omitted from the message)", async () => {
    testingBotApiMock.getUserInfo = vi.fn().mockRejectedValue(new Error("network"));
    const openBrowser = (url: string) => {
      void fetch(callbackUrlFrom(url, "key=lk&secret=ls")).catch(() => {});
    };

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, { openBrowser });
    const res = await tools.tb_login.handler({});

    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("Logged in to TestingBot.");
    expect(res.content[0].text).not.toContain("Logged in as");
    expect(fs.existsSync(path.join(tmpDir, "credentials"))).toBe(true);
    expect(configMock["testingbot-key"]).toBe("lk");
  });

  it("is resumable: returns 'still waiting', then completes on the next call", async () => {
    process.env.TESTINGBOT_LOOPBACK_WAIT_MS = "0"; // don't block on the first call
    let authUrl = "";
    const openBrowser = (url: string) => {
      authUrl = url;
    };

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, { openBrowser });
    const first = await tools.tb_login.handler({});
    expect(first.isError).toBeFalsy();
    expect(first.content[0].text).toContain("Opened your browser");

    // The user authorizes now; the browser hits the still-open listener. Await
    // the response so the request is provably delivered (no fixed-sleep flake).
    await fetch(callbackUrlFrom(authUrl, "key=lk&secret=ls")).catch(() => {});

    const second = await tools.tb_login.handler({});
    expect(second.content[0].text).toContain("Logged in as ada@example.com");
  });

  it("explicit mode 'device' abandons an in-flight loopback and switches to a code", async () => {
    process.env.TESTINGBOT_LOOPBACK_WAIT_MS = "0";
    const openBrowser = vi.fn(); // never fires a callback (remote box)
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/mcp/oauth/device/code")) return okResp(CODE);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, { openBrowser });
    const first = await tools.tb_login.handler({}); // loopback pending
    expect(first.content[0].text).toContain("Opened your browser");

    const second = await tools.tb_login.handler({ mode: "device" }); // override → code
    expect(second.content[0].text).toContain("BCDF-GHJK");
  });

  it("does not bind a second listener on concurrent first-calls", async () => {
    process.env.TESTINGBOT_LOOPBACK_WAIT_MS = "0";
    const http = await import("node:http");
    let created = 0;
    const createServer = ((handler: any) => {
      created += 1;
      return http.createServer(handler);
    }) as unknown as typeof import("node:http").createServer;
    const openBrowser = vi.fn();

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, {
      openBrowser,
      createServer,
    });
    await Promise.all([tools.tb_login.handler({}), tools.tb_login.handler({})]);

    expect(created).toBe(1);
  });

  it("falls back to the device-code flow when no loopback port can be bound", async () => {
    // createServer whose listen() emits 'error' (port unavailable).
    const createServer = ((_handler: unknown) => {
      let errCb: ((e: Error) => void) | undefined;
      return {
        once(ev: string, cb: (e: Error) => void) {
          if (ev === "error") errCb = cb;
          return this;
        },
        on() {
          return this;
        },
        listen() {
          queueMicrotask(() => errCb?.(new Error("EADDRINUSE")));
          return this;
        },
        address() {
          return null;
        },
        close() {},
      };
    }) as unknown as typeof import("node:http").createServer;

    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/mcp/oauth/device/code")) return okResp(CODE);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const openBrowser = vi.fn();

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, {
      openBrowser,
      createServer,
    });
    const res = await tools.tb_login.handler({});

    expect(res.content[0].text).toContain("BCDF-GHJK"); // device code shown
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("mode 'device' forces the device-code flow even when loopback is the default", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/mcp/oauth/device/code")) return okResp(CODE);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const openBrowser = vi.fn();

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, { openBrowser });
    const res = await tools.tb_login.handler({ mode: "device" });

    expect(res.content[0].text).toContain("BCDF-GHJK");
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("auto mode uses the device-code flow on a headless/SSH machine", async () => {
    delete process.env.TESTINGBOT_AUTH_MODE; // auto
    process.env.SSH_CONNECTION = "1.2.3.4 5 6.7.8.9 22";
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/mcp/oauth/device/code")) return okResp(CODE);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const openBrowser = vi.fn();

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, { openBrowser });
    const res = await tools.tb_login.handler({});

    expect(res.content[0].text).toContain("BCDF-GHJK");
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("completes (not discards) an already-succeeded loopback even when re-called with mode:device", async () => {
    process.env.TESTINGBOT_LOOPBACK_WAIT_MS = "0";
    let authUrl = "";
    const openBrowser = (url: string) => {
      authUrl = url;
    };

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, { openBrowser });
    await tools.tb_login.handler({}); // pending, listener open
    await fetch(callbackUrlFrom(authUrl, "key=lk&secret=ls")).catch(() => {}); // genuine callback
    await new Promise((r) => setTimeout(r, 20)); // let settled.value populate

    const res = await tools.tb_login.handler({ mode: "device" });
    expect(res.content[0].text).toContain("Logged in as ada@example.com");
    expect(configMock["testingbot-key"]).toBe("lk");
  });

  it("completes the login only once when two resume calls race the same callback", async () => {
    process.env.TESTINGBOT_LOOPBACK_WAIT_MS = "0";
    serverMock.reinitializeAfterLogin = vi.fn().mockResolvedValue(undefined);
    let authUrl = "";
    const openBrowser = (url: string) => {
      authUrl = url;
    };

    const tools = addAuthTools(serverMock, testingBotApiMock, configMock, { openBrowser });
    await tools.tb_login.handler({}); // pending
    await fetch(callbackUrlFrom(authUrl, "key=lk&secret=ls")).catch(() => {});
    await new Promise((r) => setTimeout(r, 20));

    const [a, b] = await Promise.all([tools.tb_login.handler({}), tools.tb_login.handler({})]);
    const texts = [a.content[0].text, b.content[0].text];
    expect(texts.some((t: string) => t.includes("Logged in as ada@example.com"))).toBe(true);
    // The racing call must NOT re-complete (double automation re-register) or start a stray flow.
    expect(serverMock.reinitializeAfterLogin).toHaveBeenCalledTimes(1);
    expect(texts.some((t: string) => t.includes("Opened your browser"))).toBe(false);
  });
});
