import { createRequire } from "module";

const require = createRequire(import.meta.url);
const TestingBot = require("testingbot-api");

const DEFAULT_API_BASE = "https://api.testingbot.com";

// A `testingbot-api` client that authenticates with the caller's OAuth bearer
// instead of HTTP Basic. Every request in that package goes through `_send`
// (request, uploadFile, createSession), so that is the one place to swap the
// credentials: drop axios' `auth` (Basic) and set `Authorization: Bearer`.
//
// With no token (an anonymous call to a public tool such as getBrowsers) no
// Authorization header is sent at all.
//
// The package's constructor falls back to TESTINGBOT_KEY/SECRET env vars and
// ~/.testingbot when no key is passed. Dummy values stop that: a hosted process
// must never pick up an operator's own credentials.
export function createBearerApi(token: string | null, apiBase: string = DEFAULT_API_BASE): any {
  const api = new TestingBot({ api_key: "hosted", api_secret: "hosted" });
  const base = apiBase.replace(/\/+$/, "");
  const originalSend = api._send.bind(api);

  api._send = (requestOptions: any, callback?: any) => {
    const opts = { ...requestOptions, headers: { ...(requestOptions.headers || {}) } };
    delete opts.auth;
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    if (
      typeof opts.url === "string" &&
      opts.url.startsWith(DEFAULT_API_BASE) &&
      base !== DEFAULT_API_BASE
    ) {
      opts.url = base + opts.url.slice(DEFAULT_API_BASE.length);
    }
    return originalSend(opts, callback);
  };

  // Share links are an md5 over key:secret; there is no key here. Refuse
  // rather than hand out a hash of the dummy values.
  api.getAuthenticationHashForSharing = () => {
    throw new Error("Share links are not available on the hosted MCP server.");
  };

  return api;
}
