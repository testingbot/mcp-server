import { z } from "zod";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError, sleep as realSleep } from "../lib/utils.js";
import { writeCredentialsFile, type DeviceCredentials } from "../lib/credentials.js";
import logger from "../lib/logger.js";

// Browser-based authentication for the TestingBot MCP server. No API key or
// secret is ever copied or pasted; tb_login hands back the user's existing
// client_key/client_secret and writes them to ~/.testingbot/credentials.
//
// Two mechanisms, auto-selected:
//   1. LOOPBACK (default on a desktop): open the browser to /auth?port=...&
//      identifier=testingbot-mcp and capture the redirect to a localhost
//      listener (RFC 8252 style). Seamless — nothing to type.
//   2. DEVICE CODE (RFC 8628; used on headless/remote machines or via
//      mode:"device"): print a short URL + code; the user enters it in any
//      browser. Resumable across tb_login calls.
//
// Device endpoints (POST /mcp/oauth/device/{code,token}); loopback endpoint
// (GET /auth -> redirect to http://127.0.0.1:<port>/callback?key=&secret=).

const SLOW_DOWN_INCREMENT_MS = 5_000;
// Floor for the poll interval so a missing/zero/garbled `interval` from the
// server can never turn polling into a tight, server-hammering loop.
const MIN_POLL_INTERVAL_MS = 1_000;
const DEFAULT_INTERVAL_MS = 5_000; // RFC 8628 §3.5 default when `interval` is omitted.
const DEFAULT_EXPIRES_IN_S = 900; // Fallback flow lifetime when `expires_in` is missing.

// Base URL of the TestingBot endpoints. Read at call time so a staging override
// (TESTINGBOT_BASE_URL) set before launch is honored and tests aren't bound to
// import-time evaluation.
function baseUrl(): string {
  return process.env.TESTINGBOT_BASE_URL ?? "https://testingbot.com";
}

// How long a single `tb_login` call blocks waiting for the user before returning
// "still waiting" and asking the agent to call again. Kept under common MCP
// client tool-call timeouts. The underlying flow stays alive across calls, so a
// client timeout simply means the next call resumes and completes.
function pollWindowMs(): number {
  const fromEnv = Number(process.env.TESTINGBOT_DEVICE_POLL_WINDOW_MS);
  return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 25_000;
}

function loopbackWaitMs(): number {
  const fromEnv = Number(process.env.TESTINGBOT_LOOPBACK_WAIT_MS);
  return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 60_000;
}

// The loopback listener stays open this long (across multiple tb_login calls) so
// a slow user can still complete after an intermediate "still waiting" reply.
function loopbackLifetimeMs(): number {
  const fromEnv = Number(process.env.TESTINGBOT_LOOPBACK_LIFETIME_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 900_000;
}

type AuthMode = "auto" | "loopback" | "device";

function resolveMode(arg?: string): AuthMode {
  const m = (arg ?? process.env.TESTINGBOT_AUTH_MODE ?? "auto").toLowerCase();
  return m === "loopback" || m === "device" ? m : "auto";
}

// Best-effort detection of environments where a local browser/loopback can't
// work (SSH, dev containers, headless Linux). Used only to pick the default
// mechanism in "auto"; the user can always override with mode.
function looksHeadless(): boolean {
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return true;
  if (process.env.CODESPACES || process.env.REMOTE_CONTAINERS || process.env.GITPOD_WORKSPACE_ID) {
    return true;
  }
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return true;
  }
  return false;
}

// Open the user's default browser. Best-effort and non-fatal — the URL is always
// printed too, so a failure to spawn just means the user clicks the link.
function openBrowser(url: string): void {
  try {
    let cmd: string;
    let args: string[];
    if (process.platform === "darwin") {
      cmd = "open";
      args = [url];
    } else if (process.platform === "win32") {
      cmd = "cmd";
      args = ["/c", "start", "", url];
    } else {
      cmd = "xdg-open";
      args = [url];
    }
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* command missing — ignore, the URL is shown to the user */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

interface ActiveFlow {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: number; // epoch ms
  intervalMs: number;
}

export type PollResult =
  | { status: "approved"; creds: DeviceCredentials }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "pending"; intervalMs: number };

interface PollDeps {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

// Poll POST /mcp/oauth/device/token until a terminal state or `deadline`.
// Polls at least once (so a re-call after the user has approved resolves
// immediately), then sleeps `interval` between polls, honoring `slow_down`.
// Exported for unit testing with an injected clock.
export async function pollDeviceToken(
  baseUrl: string,
  deviceCode: string,
  deadline: number,
  intervalMs: number,
  deps: PollDeps = {}
): Promise<PollResult> {
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetchImpl ?? fetch;

  let interval = intervalMs;
  for (;;) {
    const res = await doFetch(`${baseUrl}/mcp/oauth/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });

    if (res.ok) {
      let creds: DeviceCredentials;
      try {
        creds = (await res.json()) as DeviceCredentials;
      } catch {
        throw new Error(
          "The login server returned an unreadable success response. Run tb_login again."
        );
      }
      if (!creds?.client_key || !creds?.client_secret || !creds?.user?.email) {
        throw new Error("The login response was missing credentials. Run tb_login again.");
      }
      return { status: "approved", creds };
    }

    const err = (await res.json().catch(() => ({ error: "unknown" }))) as { error?: string };
    switch (err.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        interval += SLOW_DOWN_INCREMENT_MS;
        break;
      case "access_denied":
        return { status: "denied" };
      case "expired_token":
      case "invalid_grant":
        return { status: "expired" };
      default:
        throw new Error(
          `Unexpected response from device token endpoint: ${err.error ?? `HTTP ${res.status}`}`
        );
    }

    // A non-finite deadline (e.g. derived from a bad expires_in) must never spin.
    if (!Number.isFinite(deadline) || now() >= deadline) {
      return { status: "pending", intervalMs: interval };
    }
    await sleep(interval);
  }
}

// Coerce an untrusted numeric field, falling back to a default when it is
// missing / non-numeric / non-positive.
function positiveNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function startDeviceFlow(): Promise<ActiveFlow> {
  const res = await fetch(`${baseUrl()}/mcp/oauth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: "testingbot-mcp" }),
  });
  if (!res.ok) {
    throw new Error(`Could not start login (device/code returned HTTP ${res.status}).`);
  }
  let code: DeviceCodeResponse;
  try {
    code = (await res.json()) as DeviceCodeResponse;
  } catch {
    throw new Error("The login server returned an unreadable response. Run tb_login again.");
  }
  if (!code?.device_code || !code?.user_code || !code?.verification_uri) {
    throw new Error("The login server returned an incomplete response. Run tb_login again.");
  }
  // The response is untrusted JSON: clamp expires_in / interval so a missing or
  // garbled value can never produce a never-expiring flow or a tight poll loop.
  const expiresInS = positiveNumber(code.expires_in, DEFAULT_EXPIRES_IN_S);
  const intervalMs = Math.max(
    positiveNumber(code.interval, DEFAULT_INTERVAL_MS / 1000) * 1000,
    MIN_POLL_INTERVAL_MS
  );
  return {
    deviceCode: code.device_code,
    userCode: code.user_code,
    verificationUri: code.verification_uri,
    verificationUriComplete: code.verification_uri_complete ?? code.verification_uri,
    expiresAt: Date.now() + expiresInS * 1000,
    intervalMs,
  };
}

function deviceInstructions(flow: ActiveFlow): string {
  return [
    `To finish signing in to TestingBot:`,
    ``,
    `1. Open ${flow.verificationUri} in your browser`,
    `2. Enter the code: ${flow.userCode}`,
    `   (or open ${flow.verificationUriComplete} to pre-fill it)`,
    `3. Sign in if needed, then click **Authorize**`,
    ``,
    `Once you've authorized in the browser, run \`tb_login\` again and I'll complete the sign-in. No API key or secret to copy.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Loopback (RFC 8252-style) listener
// ---------------------------------------------------------------------------

export type LoopbackResult =
  | { status: "success"; clientKey: string; clientSecret: string }
  | { status: "denied"; message: string }
  | { status: "timeout" };

interface LoopbackHandle {
  port: number;
  result: Promise<LoopbackResult>;
  close: () => void;
}

interface ActiveLoopback {
  authUrl: string;
  result: Promise<LoopbackResult>;
  settled: { value: LoopbackResult | null };
  close: () => void;
  expiresAt: number;
}

// Race a promise against a timeout WITHOUT leaving a dangling timer: if the
// promise wins, the timer is cleared so it can't keep the Node event loop alive.
function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([
    promise.then((value) => {
      clearTimeout(timer);
      return value;
    }),
    timeout,
  ]);
}

// Constant-time string compare for the loopback CSRF state token.
function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function callbackHtml(ok: boolean): string {
  const heading = ok ? "✓ Connected" : "Authorization failed";
  const body = ok
    ? "You're connected. Return to your terminal — you can close this tab."
    : "Authorization didn't complete. Return to your terminal and try again.";
  return `<!doctype html><html><head><meta charset="utf-8"><title>TestingBot</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem;color:#111"><h1>${heading}</h1><p>${body}</p></body></html>`;
}

// Bind a localhost listener for the loopback callback. Resolves to a handle on
// success, or null if a port can't be bound (caller falls back to device flow).
// `createServerImpl` is injectable for tests.
export function startLoopback(
  lifetimeMs: number,
  expectedState: string,
  createServerImpl: typeof createServer = createServer
): Promise<LoopbackHandle | null> {
  return new Promise((resolveStart) => {
    let resolveResult!: (r: LoopbackResult) => void;
    const result = new Promise<LoopbackResult>((r) => {
      resolveResult = r;
    });
    let done = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (r: LoopbackResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* ignore */
      }
      resolveResult(r);
    };

    const server = createServerImpl((req: IncomingMessage, res: ServerResponse) => {
      let parsed: URL;
      try {
        parsed = new URL(req.url ?? "/", "http://127.0.0.1");
      } catch {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }
      // The genuine flow is a top-level browser navigation (GET). Rejecting
      // other methods blunts cross-site form-POST injection. Defense in depth —
      // the state check below is the primary guard.
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }
      if (parsed.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      // CSRF/state guard: only a callback carrying our per-flow state token is
      // accepted. This stops another local process or a malicious web page from
      // injecting credentials into the open listener. Mismatches are rejected
      // WITHOUT resolving, so the genuine callback can still arrive.
      const state = parsed.searchParams.get("state");
      if (!state || !constantTimeEqual(state, expectedState)) {
        res.statusCode = 400;
        res.end("Invalid or missing state");
        return;
      }
      const key = parsed.searchParams.get("key");
      const secret = parsed.searchParams.get("secret");
      const error = parsed.searchParams.get("error");
      const ok = !error && !!key && !!secret;
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(callbackHtml(ok));
      if (error) finish({ status: "denied", message: error });
      else if (ok)
        finish({ status: "success", clientKey: key as string, clientSecret: secret as string });
      else finish({ status: "denied", message: "Malformed callback" });
    });

    server.once("error", () => {
      if (done) return;
      done = true;
      try {
        server.close();
      } catch {
        /* ignore */
      }
      resolveStart(null);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      if (!port) {
        finish({ status: "timeout" });
        resolveStart(null);
        return;
      }
      timer = setTimeout(() => finish({ status: "timeout" }), lifetimeMs);
      // Don't let the lifetime timer alone keep the process alive on shutdown.
      timer.unref?.();
      resolveStart({ port, result, close: () => finish({ status: "timeout" }) });
    });
  });
}

// ---------------------------------------------------------------------------
// Shared completion + response helpers
// ---------------------------------------------------------------------------

function textResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

async function reinitializeCredentialDependentTools(server: any): Promise<void> {
  try {
    await server?.reinitializeAfterLogin?.();
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "Could not refresh credential-dependent tools after login; automation tools may need a client restart"
    );
  }
}

// Persist creds + update the live session so subsequent tool calls work without
// a restart (the testingbot-api client reads api_key/api_secret from `options`
// per request; tools reading the shared config see the mutated values too).
// Automation tools are refreshed separately (they freeze creds at registration).
// `email` is known from the device-token response; for the loopback callback
// (which carries only key+secret) we look it up to confirm the creds and label
// the saved file.
async function completeLogin(
  server: any,
  testingBotApi: any,
  config: TestingBotConfig,
  creds: { clientKey: string; clientSecret: string; email?: string }
) {
  config["testingbot-key"] = creds.clientKey;
  config["testingbot-secret"] = creds.clientSecret;
  if (testingBotApi && typeof testingBotApi === "object") {
    testingBotApi.options = testingBotApi.options || {};
    testingBotApi.options.api_key = creds.clientKey;
    testingBotApi.options.api_secret = creds.clientSecret;
  }

  let email = creds.email;
  if (!email && testingBotApi?.getUserInfo) {
    try {
      const info = await testingBotApi.getUserInfo();
      email = info?.email;
    } catch {
      /* best effort — credentials are written regardless */
    }
  }

  const path = writeCredentialsFile({
    client_key: creds.clientKey,
    client_secret: creds.clientSecret,
    user: { email: email ?? "unknown" },
  });

  void reinitializeCredentialDependentTools(server);
  logger.info({ email }, "TestingBot login succeeded");

  return textResult(
    [
      email ? `✓ Logged in as ${email}.` : `✓ Logged in to TestingBot.`,
      ``,
      `Credentials saved to ${path}.`,
      `They're used automatically from now on — no restart needed.`,
    ].join("\n")
  );
}

interface AuthDeps {
  openBrowser?: (url: string) => void;
  createServer?: typeof createServer;
}

const loginSchema = {
  mode: z
    .enum(["auto", "loopback", "device"])
    .optional()
    .describe(
      'How to authenticate. "auto" (default): open the browser and capture the callback on a local port; ' +
        'falls back to a copy-paste code on headless/remote machines. "loopback": force the browser flow. ' +
        '"device": force the copy-paste code flow (use this on SSH/remote/dev-container/web setups where the ' +
        "browser can't reach this machine)."
    ),
};

export default function addAuthTools(
  server: any,
  testingBotApi: any,
  config: TestingBotConfig,
  deps: AuthDeps = {}
) {
  const tools: Record<string, any> = {};
  const openBrowserFn = deps.openBrowser ?? openBrowser;
  const createServerImpl = deps.createServer ?? createServer;

  // Resumable state for this server instance.
  let activeFlow: ActiveFlow | null = null; // device-code flow
  let activeLoopback: ActiveLoopback | null = null; // loopback flow
  // Synchronous sentinel: set before the (async) listener bind so two concurrent
  // first-calls can't each bind a listener and leak one.
  let loopbackStarting = false;
  // Set synchronously while a loopback success is being finalized so a concurrent
  // re-call can't also complete it (double completeLogin / double automation
  // re-register) or start a stray fresh flow. Checked at handler entry.
  let loginInProgress = false;

  async function finishLoopback(result: LoopbackResult) {
    activeLoopback = null;
    if (result.status === "success") {
      loginInProgress = true;
      try {
        return await completeLogin(server, testingBotApi, config, {
          clientKey: result.clientKey,
          clientSecret: result.clientSecret,
        });
      } finally {
        loginInProgress = false;
      }
    }
    if (result.status === "denied") {
      return textResult(
        "Authorization was denied or failed in the browser. Run `tb_login` again to retry.",
        true
      );
    }
    return textResult(
      "The login window expired before you authorized. Run `tb_login` again to reopen the browser, " +
        'or run it with mode "device" to use a copy-paste code instead.',
      true
    );
  }

  function loopbackPending(authUrl: string) {
    return textResult(
      [
        `Opened your browser to authorize TestingBot.`,
        ``,
        `If it didn't open, visit:`,
        authUrl,
        ``,
        `Sign in if needed, then click **Authorize**. After you authorize, run \`tb_login\` again to finish.`,
        ``,
        `On a remote / SSH / dev-container / web setup where the browser can't reach this machine, run \`tb_login\` with mode "device" for a copy-paste code instead.`,
      ].join("\n")
    );
  }

  async function beginLoopback() {
    if (loopbackStarting) {
      return textResult("A browser login is already starting — run `tb_login` again in a moment.");
    }

    // Per-flow CSRF token. testingbot.com echoes it back on the callback; we only
    // accept a callback whose state matches, so the open port is not the sole
    // secret. Generated before the sentinel so a (rare) entropy failure here can't
    // wedge loopbackStarting in the true state.
    const state = randomBytes(32).toString("base64url");

    loopbackStarting = true;

    let handle: LoopbackHandle | null;
    try {
      handle = await startLoopback(loopbackLifetimeMs(), state, createServerImpl);
    } catch (error) {
      loopbackStarting = false;
      throw error;
    }

    if (!handle) {
      loopbackStarting = false;
      logger.warn("Loopback listener unavailable; falling back to the device-code flow");
      return await beginDevice(
        "Couldn't open a local listener for the browser flow, so here's a copy-paste code instead.\n\n"
      );
    }

    const authUrl =
      `${baseUrl()}/auth?port=${handle.port}` +
      `&identifier=testingbot-mcp&state=${encodeURIComponent(state)}`;
    const settled: { value: LoopbackResult | null } = { value: null };
    handle.result.then((r) => {
      settled.value = r;
    });
    activeLoopback = {
      authUrl,
      result: handle.result,
      settled,
      close: handle.close,
      expiresAt: Date.now() + loopbackLifetimeMs(),
    };
    // Tracked now — further re-calls hit the resume path, not a second bind.
    loopbackStarting = false;

    openBrowserFn(authUrl);
    logger.info({ port: handle.port }, "Opened browser for loopback login");

    const raced = await raceWithTimeout(handle.result, loopbackWaitMs());
    if (raced) return await finishLoopback(raced);
    return loopbackPending(authUrl);
  }

  async function resumeLoopback() {
    const lb = activeLoopback as ActiveLoopback;
    if (lb.settled.value) return await finishLoopback(lb.settled.value);
    const raced = await raceWithTimeout(lb.result, loopbackWaitMs());
    if (raced) return await finishLoopback(raced);
    return loopbackPending(lb.authUrl);
  }

  async function beginDevice(prefix = "") {
    logger.info("Starting TestingBot device-authorization flow");
    activeFlow = await startDeviceFlow();
    return textResult(prefix + deviceInstructions(activeFlow));
  }

  async function resumeDevice() {
    // Capture into a local so a concurrent call clearing activeFlow can't redirect
    // this poll mid-flight.
    const flow = activeFlow as ActiveFlow;
    logger.info("Polling TestingBot device-authorization status");
    const deadline = Math.min(flow.expiresAt, Date.now() + pollWindowMs());
    const result = await pollDeviceToken(baseUrl(), flow.deviceCode, deadline, flow.intervalMs);

    switch (result.status) {
      case "approved":
        activeFlow = null;
        return await completeLogin(server, testingBotApi, config, {
          clientKey: result.creds.client_key,
          clientSecret: result.creds.client_secret,
          email: result.creds.user.email,
        });
      case "denied":
        activeFlow = null;
        return textResult(
          "Authorization was denied in the browser. Run `tb_login` again to retry.",
          true
        );
      case "expired":
        activeFlow = null;
        return textResult(
          "The login code expired (codes last 15 minutes). Run `tb_login` again to start over.",
          true
        );
      case "pending":
      default:
        if (result.status === "pending") {
          flow.intervalMs = result.intervalMs; // persist slow_down backoff across re-calls
        }
        return textResult(
          [`Still waiting for you to authorize in the browser.`, ``, deviceInstructions(flow)].join(
            "\n"
          )
        );
    }
  }

  tools.tb_login = server.tool(
    "tb_login",
    "Authenticate with TestingBot — no API key or secret to copy or paste. By default it opens your browser, you " +
      "click Authorize, and the credentials are captured automatically and saved to ~/.testingbot/credentials " +
      "(used by every later tool call this session — no restart). If your browser can't reach this machine " +
      "(SSH / remote / dev container / web), it falls back to a short URL + code you enter in any browser; pass " +
      'mode:"device" to force that. After authorizing in the browser, call tb_login again to finish. Call this ' +
      "whenever credentials are missing.",
    loginSchema,
    async (args: { mode?: AuthMode }) => {
      try {
        // A loopback success is being finalized by a concurrent call — don't
        // start a stray flow or double-complete; let that one finish.
        if (loginInProgress) {
          return textResult("Finishing your sign-in — one moment, then you're all set.");
        }

        const mode = resolveMode(args?.mode);

        // An explicit mode that differs from an in-flight flow abandons it and
        // starts the requested mechanism — otherwise the resume below would trap
        // a user (e.g. on SSH) who asked for mode:"device" inside a live loopback.
        // But if the loopback already succeeded (callback arrived), complete that
        // login rather than discarding a valid authorization the user just granted.
        if (mode === "device" && activeLoopback) {
          if (activeLoopback.settled.value?.status === "success") {
            return await resumeLoopback();
          }
          activeLoopback.close();
          activeLoopback = null;
        }
        if (mode === "loopback" && activeFlow) {
          activeFlow = null;
        }

        // Resume an in-flight flow first so re-calls complete it.
        if (activeLoopback && Date.now() < activeLoopback.expiresAt) {
          return await resumeLoopback();
        }
        activeLoopback = null;

        if (activeFlow && Date.now() < activeFlow.expiresAt) {
          return await resumeDevice();
        }
        activeFlow = null;

        // Start fresh: device flow when forced, or in auto on a headless box.
        if (mode === "device" || (mode === "auto" && looksHeadless())) {
          return await beginDevice();
        }
        return await beginLoopback();
      } catch (error) {
        return handleMCPError("tb_login", error);
      }
    }
  );

  return tools;
}
