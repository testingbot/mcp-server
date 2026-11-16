import crypto from "crypto";

// Validates OAuth access tokens with the authorization server's RFC 7662
// introspection endpoint (testingbot.com/oauth/introspect, LAN only, shared
// secret). Results are cached for 60 s keyed by the token's SHA-256, so a
// revoked token stops working within a minute and the hot path makes at most
// one introspection call per token per minute.

export interface TokenInfo {
  active: boolean;
  sub?: string;
  client_id?: string;
  scope?: string;
  aud?: string;
  exp?: number;
  tb_user_role?: string;
}

export interface IntrospectorOptions {
  url: string;
  secret: string;
  // Sent as the Host header: introspection goes to Puma's local bind, never
  // through Cloudflare, and Rails routes on the host.
  hostHeader?: string;
  ttlMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function tokenDigest(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class Introspector {
  private cache = new Map<string, { info: TokenInfo; until: number }>();
  private opts: Required<Omit<IntrospectorOptions, "hostHeader">> & { hostHeader?: string };

  constructor(opts: IntrospectorOptions) {
    this.opts = {
      ttlMs: 60_000,
      timeoutMs: 5_000,
      fetchImpl: fetch,
      now: Date.now,
      ...opts,
    };
  }

  async introspect(token: string): Promise<TokenInfo> {
    const key = tokenDigest(token);
    const now = this.opts.now();
    const hit = this.cache.get(key);
    if (hit && hit.until > now) return hit.info;

    const info = await this.fetchInfo(token);
    // Never cache past the token's own expiry.
    const expMs = info.exp ? info.exp * 1000 : Infinity;
    this.cache.set(key, { info, until: Math.min(now + this.opts.ttlMs, expMs) });
    this.prune(now);
    return info;
  }

  private async fetchInfo(token: string): Promise<TokenInfo> {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "X-TB-Introspect-Secret": this.opts.secret,
    };
    if (this.opts.hostHeader) headers.Host = this.opts.hostHeader;
    const response = await this.opts.fetchImpl(this.opts.url, {
      method: "POST",
      headers,
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    // Fail closed: anything but a clean answer is an inactive token. Not
    // cached as such, though: an introspection outage must not pin a valid
    // token as dead for a minute.
    if (!response.ok) throw new Error(`introspection returned HTTP ${response.status}`);
    const body = (await response.json()) as TokenInfo;
    return body && body.active === true ? body : { active: false };
  }

  private prune(now: number) {
    if (this.cache.size < 10_000) return;
    for (const [k, v] of this.cache) if (v.until <= now) this.cache.delete(k);
  }
}
