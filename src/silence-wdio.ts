// Side-effect module: silence @wdio/logger BEFORE the `webdriver` module loads.
//
// The `webdriver` package creates its logger at module-evaluation time
// (`var log = logger("webdriver")`), and @wdio/logger reads WDIO_LOG_LEVEL once,
// at that moment, then caches the logger. The default level is "info", which it
// writes to process.stdout — and for a stdio MCP server stdout is reserved for
// JSON-RPC framing, so those lines corrupt the protocol stream (the client throws
// "Unexpected non-whitespace character after JSON").
//
// ESM hoists `import` statements above top-level code, so setting this env var in
// the body of index.ts (even textually "above" the imports) runs too late —
// webdriver has already cached an info-level logger by then. Importing THIS module
// before any module that transitively imports `webdriver` guarantees the env var
// is in place in time. An operator can still override the level.
process.env.WDIO_LOG_LEVEL = process.env.WDIO_LOG_LEVEL || "silent";
