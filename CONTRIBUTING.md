# Contributing to testingbot-mcp-server

Thanks for taking the time to contribute. This document covers the basics: how
to set up your environment, how to run the test/lint/build pipeline, and what
we expect in a pull request.

## Prerequisites

- Node.js **>= 18** (CI runs on the version listed in `.github/workflows/test.yml`)
- npm (matches the lockfile committed in this repo)
- A [TestingBot account](https://testingbot.com/users/sign_up) if you want to
  exercise tools against the live API (most contributions can be developed
  against mocks)

## Setup

```bash
git clone git@github.com:testingbot/mcp-server.git
cd mcp-server
npm ci
cp .env.example .env   # optional: fill in TESTINGBOT_KEY / TESTINGBOT_SECRET for live runs
```

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the server from TypeScript source with watch mode (`tsx watch`). |
| `npm test` | Run the full vitest suite. |
| `npm run test:watch` | Re-run tests on file changes. |
| `npm run test:coverage` | Generate a coverage report. |
| `npm run lint` | Run ESLint over `src/` and `tests/`. |
| `npm run lint:fix` | Auto-fix lint issues where possible. |
| `npm run format` | Format source with Prettier (writes files). |
| `npm run format:check` | Check formatting without writing — used by `build` + CI. |
| `npm run build` | Full pipeline: `version:sync` → lint → `format:check` → test → `tsc`. |
| `npm run version:check` | CI gate that fails if `manifest.json` / `server.json` drift from `package.json`. |

The `build` script is the contract for "ready to merge" — if it passes locally,
it should pass in CI.

## Project layout

```
src/
  index.ts              # CLI entry point, signal handlers, startup
  server-factory.ts     # TestingBotMcpServer class, tool registration, preflight
  config.ts             # Env var → config parsing
  lib/
    logger.ts           # pino — stderr only (stdout is reserved for MCP JSON-RPC)
    utils.ts            # sanitizeSessionId, validateUrl, handleMCPError, formatError
    error.ts            # Custom error classes
    types.ts, constants.ts, get-auth.ts
  tools/
    <area>.ts           # One file per tool category, exports addXxxTools(server, api, config)
tests/
  tools/                # Per-tool tests
  lib/                  # Helper tests
scripts/
  sync-version.mjs      # Keeps manifest.json + server.json aligned with package.json
```

## Adding a new tool

1. Create `src/tools/<area>.ts` if no existing file fits.
2. Export a default function with the standard signature:
   ```ts
   export default function addXxxTools(server, testingBotApi, config) {
     const tools: Record<string, any> = {};
     tools.myTool = server.tool(
       "myTool",
       "One-line description shown to the model",
       { /* zod schema */ },
       async (args) => {
         try {
           // ... call testingBotApi, format output ...
           return { content: [{ type: "text", text: "..." }] };
         } catch (error) {
           return handleMCPError("myTool", error);
         }
       }
     );
     return tools;
   }
   ```
3. Register the adder in `src/server-factory.ts` (`toolAdders` array).
4. Add tests in `tests/tools/<area>.test.ts` covering happy path, error path,
   and any input-validation rules.
5. If the tool touches the user's filesystem or makes outbound network calls,
   validate inputs strictly (see `src/tools/storage.ts` for examples of path
   allowlisting and SSRF protection).

## Coding conventions

- TypeScript strict mode is on — no `any` in new code where a real type works.
- Wrap tool handlers in `try/catch` and always return via `handleMCPError` on
  failure.
- Sanitize session IDs and other identifiers with `sanitizeSessionId`.
- **Never log to stdout** — MCP uses stdio for JSON-RPC framing. The logger is
  pinned to stderr; do not introduce `console.log`.
- Sensitive fields (`api_key`, `api_secret`, `localFilePath`, `remoteUrl`,
  `args.extra`) are redacted by the logger; do not bypass the redaction list.

## Tests

- We use [Vitest](https://vitest.dev). Tests live in `tests/` and mirror the
  `src/` structure.
- Mock the `testingBotApi` client and the `server.tool` registrar (see existing
  tests for the pattern).
- Cover the failure path explicitly — not just the happy path.
- For tools that hit the filesystem or network, use `fs.mkdtempSync` for
  isolation and `vi.stubGlobal("fetch", ...)` for network mocks.

## Releasing

Versioning is automated via npm lifecycle hooks. Run `npm version <patch|minor|major>` to:
1. Bump `package.json`
2. Sync `manifest.json` and `server.json` via `scripts/sync-version.mjs`
3. Stage the changes and create a commit + tag

CI (`.github/workflows/release.yml`) publishes to npm on a published GitHub
release (which is created from the tag pushed by `npm version`).

## Pull requests

- Keep PRs focused — one feature or fix per PR.
- Branch from `main`. Reference any related issues in the description.
- Make sure `npm run build` passes locally before opening the PR.
- For user-visible changes, update the README if appropriate.
- For new tools, include a short "Prompt example" in the PR description so
  reviewers can sanity-check the natural-language interface.

## Reporting bugs / requesting features

Please open an issue at
https://github.com/testingbot/mcp-server/issues with:
- A clear description and minimal reproduction
- The MCP client you're using (Claude Desktop, Cursor, VS Code, etc.)
- Node version (`node --version`) and OS
- Relevant snippets from `logs/debug.log` (with `TESTINGBOT_DEBUG=true`) —
  scrub credentials before pasting

## License

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](LICENSE).
