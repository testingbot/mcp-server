// Side-effect module: route console.log/info/debug to stderr.
//
// A stdio MCP server owns stdout for JSON-RPC framing; a stray console.log from a
// dependency (testingbot-tunnel-launcher prints "Tunnel is ready", for one) makes
// the client fail with "Unexpected token ... is not valid JSON". The MCP SDK
// writes to process.stdout directly, so it is unaffected.
for (const method of ["log", "info", "debug"] as const) {
  console[method] = (...args: unknown[]) => console.error(...args);
}
