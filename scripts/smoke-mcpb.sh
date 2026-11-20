#!/usr/bin/env bash
# Unpack a built .mcpb and check that the server in it starts and answers
# tools/list, the way Claude Desktop runs it: `node dist/index.js` from the
# bundle, with only the bundled node_modules and no credentials (fields left
# blank arrive as unsubstituted ${user_config.*} templates).
#
#   scripts/smoke-mcpb.sh releases/testingbot-mcp-server-<version>.mcpb
set -euo pipefail

BUNDLE="${1:?usage: smoke-mcpb.sh <bundle.mcpb>}"
WORK="$(mktemp -d -t mcpb-smoke.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

unzip -q "$BUNDLE" -d "$WORK/bundle"
mkdir -p "$WORK/home"

OUT="$(
  {
    printf '%s\n' \
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mcpb-smoke","version":"1"}}}' \
      '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
    sleep 15
  } | (cd "$WORK/bundle" && HOME="$WORK/home" TESTINGBOT_CONFIG_DIR="$WORK/home/.testingbot" \
        TESTINGBOT_KEY='${user_config.testingbot-key}' TESTINGBOT_SECRET='${user_config.testingbot-secret}' \
        timeout 60 node dist/index.js 2>"$WORK/stderr.log") || true
)"

COUNT="$(printf '%s\n' "$OUT" | node -e '
  let n = 0;
  for (const line of require("fs").readFileSync(0, "utf8").split("\n")) {
    try { const m = JSON.parse(line); if (m.id === 2) n = m.result.tools.length; } catch {}
  }
  console.log(n);
')"

if [[ "$COUNT" -lt 10 ]] || ! printf '%s' "$OUT" | grep -q '"tb_login"'; then
  echo "✖ $BUNDLE: server did not list its tools (got $COUNT). stderr:" >&2
  tail -30 "$WORK/stderr.log" >&2
  exit 1
fi
echo "✓ $BUNDLE starts and lists $COUNT tools"
