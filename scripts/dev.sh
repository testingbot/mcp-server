#!/usr/bin/env bash
# Local dev rebuild for the mcp-server + automation-mcp pair.
#
# Since mcp-server now depends on @testingbot/automation-mcp via a normal npm
# version range (^0.1.0), `npm install` pulls the published version — which
# would miss your in-progress sibling changes. This script bridges that gap:
#
#   1. Build @testingbot/automation-mcp (regenerates its dist/).
#   2. Ensure it's `npm link`-ed into mcp-server's node_modules so the
#      live edits are what gets executed (not the registry copy).
#   3. Build @testingbot/mcp-server.
#
# The npm link is idempotent — if it's already in place this is a no-op
# beyond the build. After publishing a release, run `npm install` in
# mcp-server to revert to the registry copy.
#
# Run from either repo or with an absolute path. Idempotent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AUTOMATION_DIR="$(cd "$MCP_SERVER_DIR/../testingbot-automation-mcp" 2>/dev/null && pwd || true)"

color()  { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
header() { color "1;34" "==> $1"; }
ok()     { color "1;32" "✓ $1"; }
warn()   { color "1;33" "! $1"; }

if [[ -d "$AUTOMATION_DIR" ]]; then
  header "Building @testingbot/automation-mcp ($AUTOMATION_DIR)"
  ( cd "$AUTOMATION_DIR" && npm run build )
  ok "automation-mcp built"

  # Bridge the live sibling into mcp-server's node_modules via npm link.
  # Symlink check: `node_modules/@testingbot/automation-mcp` is either a
  # registry copy (regular dir) or a link to ../../testingbot-automation-mcp.
  LINK_TARGET="$MCP_SERVER_DIR/node_modules/@testingbot/automation-mcp"
  if [[ -L "$LINK_TARGET" ]]; then
    ok "automation-mcp already linked"
  else
    header "Linking automation-mcp into mcp-server node_modules"
    ( cd "$AUTOMATION_DIR" && npm link --silent )
    ( cd "$MCP_SERVER_DIR" && npm link @testingbot/automation-mcp --silent )
    ok "linked"
  fi
else
  warn "Sibling testingbot-automation-mcp not found at $MCP_SERVER_DIR/../testingbot-automation-mcp"
  warn "Skipping its build — mcp-server will use the npm-published @testingbot/automation-mcp."
fi

header "Building @testingbot/mcp-server ($MCP_SERVER_DIR)"
( cd "$MCP_SERVER_DIR" && npm run build )
ok "mcp-server built"

echo
ok "All builds complete."
echo
color "0" "Next steps:"
color "0" "  • Fully quit Claude Desktop (Cmd-Q) and reopen to pick up the new bin."
color "0" "  • Or smoke-test the standalone server:"
color "0" "      TESTINGBOT_KEY=... TESTINGBOT_SECRET=... \\"
color "0" "        node $MCP_SERVER_DIR/dist/index.js"
