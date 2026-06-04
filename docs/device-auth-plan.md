# Device-flow auth for the TestingBot MCP server

Implementation plan. Self-contained: hand this to a separate Claude session and it should be able to ship both halves (testingbot.com Rails endpoints + MCP-side `tb_login` tool) without further clarification.

---

## Why

Today, first-time MCP users have to:
1. Find the API key + secret at https://testingbot.com/members/user/security
2. Paste them into Claude Desktop's `claude_desktop_config.json` (or set env vars)
3. Restart the client

On Claude Desktop with the `.mcpb` install path, this is now a single GUI prompt (see `manifest.json#user_config` — already shipped). But for VS Code / Cursor / Cline / anything else, the user still hand-edits config and copy-pastes secrets. That's the gap this fixes.

After this lands, the cross-client flow becomes:

1. User installs the MCP, leaves credentials blank.
2. Asks the agent: _"log me in to TestingBot"_.
3. Agent calls `tb_login`. Server prints: _"Visit https://testingbot.com/device and enter `ABCD-1234`. Waiting..."_
4. User opens the URL in any browser, is already logged into testingbot.com, clicks **Authorize**.
5. Server stops polling, writes credentials to `~/.testingbot/credentials`. Agent confirms: _"You're logged in as ada@example.com."_

No JSON editing, no key pasting, no secret leaving the browser.

## Standard

This is **RFC 8628: OAuth 2.0 Device Authorization Grant**. We follow it literally except where called out — no custom auth invention. The RFC is short (≈20 pages); read it before implementing.

For the credential the server hands back at the end, we deliberately do **not** mint a new token type. The MCP needs to call the existing TestingBot REST API (`/v1/...`), which authenticates via HTTP Basic with `client_key:client_secret`. So `tb_login` returns the user's existing `client_key` + `client_secret` (from the `users` table), same values the user could have pasted manually from `/members/user/security`. This keeps the API surface unchanged. A future v2 can issue scoped/revocable per-device tokens; v1 reuses the existing creds.

---

## Part 1 — testingbot.com (Rails)

### 1.1 Storage

Use **Redis** (already available — see `config/cable.yml`). No new DB table. Two key namespaces:

- `mcp:device_code:<device_code>` → JSON blob, TTL 900s (15 min)
  ```json
  {
    "user_code": "ABCD-1234",
    "status": "pending",          // pending | approved | denied | expired
    "user_id": null,              // set when status = approved
    "interval": 5,                // polling interval hint
    "created_at": 1735488000
  }
  ```
- `mcp:user_code:<user_code>` → the matching `device_code` (lookup key for the consent page). Same 900s TTL.

User codes are 8 characters from the unambiguous alphabet `BCDFGHJKLMNPQRSTVWXZ` (no vowels, no `0/O/1/I`), grouped `XXXX-XXXX`. Device codes are 32 random url-safe base64 bytes.

### 1.2 Routes

Add to `config/routes.rb`, near the existing `match '/mcp/install' => "mcp#install"` line (line 86):

```ruby
# RFC 8628 device authorization grant for the TestingBot MCP server.
post '/mcp/oauth/device/code'  => "mcp_oauth#device_code"
post '/mcp/oauth/device/token' => "mcp_oauth#device_token"
get  '/device'                 => "mcp_oauth#consent"
post '/device'                 => "mcp_oauth#approve"
```

Path choice rationale: `/device` is the short URL printed to the user; everything else lives under `/mcp/oauth/`.

### 1.3 Controller: `app/controllers/mcp_oauth_controller.rb` (new)

Skip CSRF on the two POST API endpoints (they're called by the MCP, not by a browser). Keep CSRF on `/device` (consent page is a real browser form).

```ruby
class McpOauthController < ApplicationController
  protect_from_forgery except: [:device_code, :device_token]
  skip_before_action :verify_authenticity_token, only: [:device_code, :device_token]

  # POST /mcp/oauth/device/code
  # Initiates the device flow. Public endpoint — no auth required.
  # Body: { "client_id": "testingbot-mcp" }  (informational only in v1)
  # Response 200:
  # {
  #   "device_code": "...",
  #   "user_code": "ABCD-1234",
  #   "verification_uri": "https://testingbot.com/device",
  #   "verification_uri_complete": "https://testingbot.com/device?code=ABCD-1234",
  #   "expires_in": 900,
  #   "interval": 5
  # }
  def device_code
    device_code = SecureRandom.urlsafe_base64(32)
    user_code = generate_user_code  # unique check via Redis EXISTS

    redis.set(
      "mcp:device_code:#{device_code}",
      { user_code: user_code, status: "pending", user_id: nil, interval: 5,
        created_at: Time.now.to_i }.to_json,
      ex: 900
    )
    redis.set("mcp:user_code:#{user_code}", device_code, ex: 900)

    render json: {
      device_code: device_code,
      user_code: user_code,
      verification_uri: "#{request.base_url}/device",
      verification_uri_complete: "#{request.base_url}/device?code=#{user_code}",
      expires_in: 900,
      interval: 5
    }
  end

  # POST /mcp/oauth/device/token
  # Polled by the MCP. Per RFC 8628 §3.5 returns one of:
  #   200 + { client_key, client_secret, user: { email, id } }  — success
  #   400 + { error: "authorization_pending" }                  — keep polling
  #   400 + { error: "slow_down" }                              — interval too short
  #   400 + { error: "expired_token" }                          — re-start the flow
  #   400 + { error: "access_denied" }                          — user clicked deny
  #   400 + { error: "invalid_grant" }                          — unknown device_code
  def device_token
    code = params[:device_code]
    return render_error("invalid_grant", :bad_request) if code.blank?

    raw = redis.get("mcp:device_code:#{code}")
    return render_error("expired_token", :bad_request) if raw.nil?

    state = JSON.parse(raw)

    # slow_down: rate-limit polling. If we see two polls < interval apart,
    # bump the interval the client should use.
    if (last = state["last_poll_at"]) && Time.now.to_i - last < state["interval"]
      state["interval"] = state["interval"] + 5
      state["last_poll_at"] = Time.now.to_i
      redis.set("mcp:device_code:#{code}", state.to_json, keepttl: true)
      return render_error("slow_down", :bad_request)
    end
    state["last_poll_at"] = Time.now.to_i
    redis.set("mcp:device_code:#{code}", state.to_json, keepttl: true)

    case state["status"]
    when "pending"
      render_error("authorization_pending", :bad_request)
    when "denied"
      render_error("access_denied", :bad_request)
    when "approved"
      user = User.find(state["user_id"])
      # Burn the code so it can't be reused.
      redis.del("mcp:device_code:#{code}")
      redis.del("mcp:user_code:#{state['user_code']}")
      render json: {
        client_key: user.client_key,
        client_secret: user.client_secret,
        user: { email: user.email, id: user.id }
      }
    end
  end

  # GET /device  → consent page
  # If signed in and ?code=XXXX-XXXX present, show "Authorize MCP for your
  # account?" with the user_code displayed for confirmation. Otherwise show
  # a code-entry form.
  def consent
    @user_code = params[:code]&.upcase&.strip
    @signed_in = current_user.present?
    @valid_code = @user_code.present? && redis.exists?("mcp:user_code:#{@user_code}") == 1
    render "mcp_oauth/consent"
  end

  # POST /device  → handles approve/deny click
  # Form params: { user_code, decision: "approve" | "deny" }
  def approve
    require_user!  # 401 if not signed in
    user_code = params[:user_code].to_s.upcase.strip
    device_code = redis.get("mcp:user_code:#{user_code}")
    raise ActionController::RoutingError, "Unknown code" if device_code.nil?

    raw = redis.get("mcp:device_code:#{device_code}")
    state = JSON.parse(raw)

    state["status"] = params[:decision] == "approve" ? "approved" : "denied"
    state["user_id"] = current_user.id if state["status"] == "approved"
    redis.set("mcp:device_code:#{device_code}", state.to_json, keepttl: true)

    @decision = state["status"]
    render "mcp_oauth/result"
  end

  private

  def redis
    @redis ||= Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/1"))
  end

  ALPHABET = "BCDFGHJKLMNPQRSTVWXZ".chars.freeze

  def generate_user_code
    100.times do
      code = "#{4.times.map { ALPHABET.sample }.join}-#{4.times.map { ALPHABET.sample }.join}"
      return code unless redis.exists?("mcp:user_code:#{code}") == 1
    end
    raise "exhausted user-code keyspace"
  end

  def render_error(code, status)
    render json: { error: code }, status: status
  end
end
```

### 1.4 Views

Two new ERB templates in `app/views/mcp_oauth/`:

- `consent.html.erb` — code-entry form (when no `?code` param OR signed-out) and authorize/deny buttons (when valid code + signed in). On signed-out + valid code, redirect to `/login?return_to=/device?code=XXXX-XXXX`.
- `result.html.erb` — confirmation: "You're connected — return to your terminal." for approve; "Authorization denied. You can close this tab." for deny.

Keep them minimal — match the styling of `/members/user/security`. The approve button must be on a separate form submitting via POST with the user_code as a hidden field plus CSRF token (Rails default).

### 1.5 User flow on the consent page

```
Signed-in user opens /device?code=ABCD-1234
  → render: "Authorize TestingBot MCP for ada@example.com? [Approve] [Deny]"

Signed-in user clicks Approve
  → POST /device { user_code: "ABCD-1234", decision: "approve" }
  → Redis state.status = "approved"
  → render result page

Signed-out user opens /device?code=ABCD-1234
  → render: "Sign in to authorize" → redirect to login with return_to back here

Wrong / expired code on /device
  → render: "That code didn't match. Codes expire after 15 minutes."
```

### 1.6 Security

- **No authentication on POST /mcp/oauth/device/code** — that's per RFC. Anyone can start a flow; nothing happens until a real user approves on the consent page.
- **Polling is rate-limited** by the `slow_down` mechanism above. A client that polls faster than `interval` seconds will see its interval grow.
- **CSRF is required on `POST /device`** (consent submission) — it's a real form. Rails handles this by default with `protect_from_forgery`.
- **Device codes are single-use**: deleted from Redis after success. Re-polling returns `expired_token`.
- **User codes don't survive a restart** — they live in Redis with a 15-minute TTL. Long pauses force the user to restart, which is correct.
- **Don't log the device_code or client_secret.** Filter both in `config/initializers/filter_parameter_logging.rb`:
  ```ruby
  Rails.application.config.filter_parameters += [:device_code, :client_secret]
  ```
- **CORS**: not needed. Both API endpoints are called by the MCP server (a Node CLI), not from browsers.
- **Don't surface `client_secret` in any redirect URL.** Only `POST /mcp/oauth/device/token` ever returns it; never a query string.

### 1.7 Tests

Add `test/controllers/mcp_oauth_controller_test.rb` (or RSpec equivalent — match the project's test framework). Cover:

- `POST /mcp/oauth/device/code` returns a code pair, both in Redis with 900s TTL.
- `POST /mcp/oauth/device/token` with `pending` → 400 `authorization_pending`.
- Polling faster than `interval` → 400 `slow_down` and interval bumps.
- Unknown `device_code` → 400 `expired_token`.
- After approval (set Redis state manually) → 200 with `client_key`/`client_secret` for the right user, and Redis keys deleted.
- After denial → 400 `access_denied`.
- `GET /device?code=ABCD-1234` signed-in → renders authorize form.
- `POST /device { decision: approve }` signed-in → flips Redis state.
- `POST /device` signed-out → redirects to login with return_to set.

### 1.8 Acceptance criteria (Rails side)

- [ ] All four endpoints respond per the shapes above.
- [ ] Consent page renders correctly on both code-present and code-absent paths.
- [ ] Tests pass.
- [ ] No `client_secret` appears in `production.log` or `development.log` during the flow.
- [ ] Existing `User.api_authorize` continues to work (no model changes).

---

## Part 2 — MCP server (this repo)

### 2.1 The `tb_login` tool

New file: `src/tools/auth.ts`. Registered alongside the other tool families in `src/server-factory.ts` via `addAuthTools(this, this.config)`.

```typescript
// src/tools/auth.ts
import { z } from "zod";
import { writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

const BASE = process.env.TESTINGBOT_BASE_URL ?? "https://testingbot.com";

export default function addAuthTools(server: any, _config: any) {
  const tools: Record<string, any> = {};

  tools.tb_login = server.tool(
    "tb_login",
    "Authenticate with TestingBot via device flow. Prints a URL + short code; the user opens the URL in a browser, signs in (if not already), and clicks Authorize. The credentials are then written to ~/.testingbot/credentials and used by every subsequent tool call in this server — no restart needed. **Use this when credentials are missing**; the user does not need to copy or paste any key or secret.",
    {},
    async () => {
      try {
        // 1. Get a device + user code.
        const codeRes = await fetch(`${BASE}/mcp/oauth/device/code`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_id: "testingbot-mcp" }),
        });
        if (!codeRes.ok) {
          throw new Error(`device/code returned ${codeRes.status}`);
        }
        const code = await codeRes.json() as {
          device_code: string;
          user_code: string;
          verification_uri: string;
          verification_uri_complete: string;
          expires_in: number;
          interval: number;
        };

        // 2. Tell the agent so it can tell the user.
        //    We RETURN this text — the agent surfaces it. The user opens the
        //    URL in their browser; the MCP keeps polling until they approve.
        const expiresAt = Date.now() + code.expires_in * 1000;
        let interval = code.interval * 1000;

        const pollResult = await pollUntilAuthorized(
          code.device_code, expiresAt, interval
        );

        // 3. Persist creds for next launch (env override always wins).
        const credPath = writeCredentialsFile(pollResult);

        return {
          content: [{
            type: "text",
            text: [
              `✓ Logged in as ${pollResult.user.email}.`,
              ``,
              `Credentials saved to ${credPath}.`,
              `They are used automatically on every future launch — no restart needed.`,
            ].join("\n"),
          }],
        };
      } catch (error) {
        return handleMCPError("tb_login", error);
      }
    }
  );

  return tools;
}

async function pollUntilAuthorized(
  deviceCode: string, expiresAt: number, interval: number
): Promise<{ client_key: string; client_secret: string; user: { email: string; id: number } }> {
  while (Date.now() < expiresAt) {
    await new Promise(r => setTimeout(r, interval));
    const res = await fetch(`${BASE}/mcp/oauth/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });
    if (res.ok) {
      return await res.json() as any;
    }
    const err = await res.json().catch(() => ({ error: "unknown" }));
    switch (err.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval += 5000;
        continue;
      case "access_denied":
        throw new Error("Authorization was denied. Run tb_login again to retry.");
      case "expired_token":
        throw new Error("The login code expired (15 min). Run tb_login again.");
      default:
        throw new Error(`Unexpected response: ${err.error ?? res.status}`);
    }
  }
  throw new Error("Login timed out without approval. Run tb_login again.");
}

function writeCredentialsFile(creds: {
  client_key: string; client_secret: string; user: { email: string }
}): string {
  const dir = join(homedir(), ".testingbot");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "credentials");
  const body = [
    `# Written by @testingbot/mcp-server tb_login at ${new Date().toISOString()}`,
    `# Account: ${creds.user.email}`,
    `[default]`,
    `key = ${creds.client_key}`,
    `secret = ${creds.client_secret}`,
    "",
  ].join("\n");
  writeFileSync(path, body, { mode: 0o600 });
  return path;
}
```

**Caveat — the polling pause**: `tb_login` blocks until the user clicks. That's fine for a CLI but inside an MCP tool call it means the tool sits open while the user does something offline. Most clients (Claude Desktop, Cursor, VS Code Copilot Chat) tolerate this; the agent will simply wait. If you find a client that times the tool call out, lift the cap or shorten the wait window and have the agent re-call.

### 2.2 Credentials file format

INI-style with a single `[default]` profile for now. Future profiles (e.g. team accounts) just add another `[name]` block. The file is mode `0600` and lives in a `0700` directory — same UNIX-y convention as `~/.aws/credentials` and `~/.ssh/`.

```ini
# Written by @testingbot/mcp-server tb_login at 2025-12-04T13:42:00.000Z
# Account: ada@example.com
[default]
key = <hex>
secret = <hex>
```

### 2.3 Credential loading priority

Update `src/config.ts`. Order, highest precedence first:

1. **Environment variables**: `TESTINGBOT_KEY` / `TESTINGBOT_SECRET` (and legacy `TB_KEY` / `TB_SECRET`). Lets CI override.
2. **Credentials file**: `~/.testingbot/credentials`, profile `default` (overridable via `TESTINGBOT_PROFILE` env). Set by `tb_login`.
3. **Missing**: server enters a degraded mode where every tool except `tb_login` returns an error like _"No TestingBot credentials configured. Run tb_login to authenticate."_

Add a tiny INI parser inline (it's <20 lines). Don't add a dependency.

```typescript
// src/config.ts (sketch)
function loadFromCredentialsFile(): { key: string; secret: string } | null {
  const path = join(homedir(), ".testingbot", "credentials");
  if (!existsSync(path)) return null;
  const profile = process.env.TESTINGBOT_PROFILE ?? "default";
  const text = readFileSync(path, "utf8");
  let current: string | null = null;
  const out: Record<string, Record<string, string>> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section) { current = section[1]; out[current] = {}; continue; }
    if (!current) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    out[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const p = out[profile];
  if (!p?.key || !p?.secret) return null;
  return { key: p.key, secret: p.secret };
}
```

### 2.4 Preflight change

`src/server-factory.ts#preflight()` currently throws if credentials are missing. Soften it: if credentials are missing AND `tb_login` is registered, log a warning and proceed. Every tool that needs credentials will fail individually with a clear "Run tb_login" message; the agent will then call `tb_login`. This makes the first-run experience self-healing.

### 2.5 Tests

Add `tests/tools/auth.test.ts`:
- `tb_login` calls `/mcp/oauth/device/code` and returns its user_code in the text shown to the agent (uses `vi.fn` to mock `fetch`).
- Polling: returns `authorization_pending` 3 times then 200 → tool resolves with success message.
- `slow_down` response bumps the interval.
- `access_denied` → tool returns isError with "denied" message.
- `expired_token` → tool returns isError.
- File is written with mode 0600 to a tempdir (use `os.tmpdir()` and override `HOME` in the test).

Add `tests/config.test.ts` cases:
- Env vars take precedence over file.
- File-only is honored.
- Bad profile falls back to "no creds".
- Missing file is not an error.

### 2.6 Acceptance criteria (MCP side)

- [ ] `tb_login` works against a running testingbot.com staging deploy.
- [ ] `~/.testingbot/credentials` is created mode 0600 in a 0700 directory.
- [ ] After login, subsequent tool calls (e.g. `getUserInfo`) succeed without restarting the MCP.
- [ ] Env vars still override the file.
- [ ] All tests pass; build pipeline green.

---

## Out of scope (deliberately deferred to v2)

- **Per-device scoped tokens with revocation**. v1 returns the user's existing `client_key`/`client_secret`. v2 should mint a separate `mcp_tokens` table row per device, expose it under `/members/user/security` for revocation, and have the MCP send it as `Authorization: Bearer <token>` instead of HTTP Basic. Requires a server-side migration and changes to `User.api_authorize`.
- **Refresh tokens**. v1 credentials don't expire (since they're the user's regular API creds). v2 with scoped tokens should pair access + refresh per RFC 6749 §1.5.
- **A `testingbot logout` flow**. Today: delete `~/.testingbot/credentials` manually. v2: add `tb_logout` that also revokes the scoped token server-side.
- **Multiple profiles UI**. v1 supports `TESTINGBOT_PROFILE` env var; you can edit the file by hand to add accounts. No tool yet to switch.
- **Browser auto-open**. v1 prints the URL and lets the agent show it. We could shell out to `open` / `xdg-open` / `start` from `tb_login` but it's optional and may be unwelcome in some environments (headless dev containers, SSH sessions).

---

## Roll-out

1. Land Rails endpoints behind a feature flag or environment gate; deploy to staging.
2. Add `tb_login` to the MCP server pointing at staging via `TESTINGBOT_BASE_URL=https://staging.testingbot.com`.
3. Smoke-test end-to-end on staging.
4. Flip prod.
5. Update the MCP server README's "Authentication" section to recommend `tb_login` as the primary path for non-Claude-Desktop users, with the manual env-var path as fallback.
6. Optional: add a banner on `/members/user/security` mentioning the new login flow for MCP users.

---

## Open questions for the implementer

- Should we accept the `client_id` parameter in v1 (RFC says it's required) but ignore it, or enforce a fixed value? Recommendation: accept and ignore — v2 may use it to differentiate MCP clients (Claude Desktop vs Cursor vs CI) for analytics.
- Should the consent page list the scopes being granted? In v1 there are no scopes — it's full account access. Recommend showing a clear "This will give the MCP full access to your TestingBot account" warning. Add a "Learn more" link to docs.
- Should we email the user after a successful authorization? Probably yes ("A new device was authorized for your TestingBot account") — same pattern as the existing 2FA flow. Add to v1.
