#!/usr/bin/env bash
# Build a distributable .mcpb bundle of @testingbot/mcp-server.
#
# Output: releases/testingbot-mcp-server-<version>.mcpb
#
# What it does:
#   1. Runs `npm run build` so the bundle reflects a clean lint+test+tsc pass.
#   2. Stages a fresh copy of the runtime tree in a temp dir.
#   3. `npm ci --omit=dev` in that staging dir — dev deps (typescript, eslint,
#      vitest, etc.) never reach the bundle, only what's needed at runtime.
#   4. `mcpb pack` honors .mcpbignore to strip test fixtures, source maps,
#      and dependency CHANGELOGs out of node_modules too.
#   5. `mcpb info` on the result so failures show up before you ship it.
#
# Why we stage instead of packing the repo in place: the active checkout has
# dev deps installed (you're working on it) and a populated dist/ + tests/
# tree. The staging dir gets exactly what runs in production and nothing
# else. Costs ~30 s of npm install; worth it for a release artefact.
#
# Dependency note: this script expects `@testingbot/automation-mcp` to be
# published to npm at the version specified in package.json. For local
# development the dev:rebuild script uses `npm link` to bridge changes from
# the sibling repo — see README "Development setup" for the one-time link.
#
# Iteration tip: for inner-loop testing of source changes, use
# `npm run dev:rebuild` — it skips the bundle step entirely. Only run this
# script when you're about to publish to the .mcpb releases page.

set -euo pipefail

color()  { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
header() { color "1;34" "==> $1"; }
ok()     { color "1;32" "✓ $1"; }
warn()   { color "1;33" "! $1"; }
fail()   { color "1;31" "✗ $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

command -v mcpb >/dev/null || fail "mcpb CLI not found. Install with: npm i -g @anthropic-ai/mcpb"

VERSION="$(node -p "require('./package.json').version")"
[[ -n "$VERSION" ]] || fail "package.json version is empty"

header "1/5  npm run build (lint → format → test → tsc)"
npm run build
ok "build green"

header "2/5  staging clean runtime tree"
STAGE="$(mktemp -d -t testingbot-mcpb.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

# Files actually needed by the bundle at runtime. Anything not in this list
# never reaches node_modules either (via npm ci --omit=dev).
cp manifest.json     "$STAGE/"
cp package.json      "$STAGE/"
cp package-lock.json "$STAGE/"
cp -R dist           "$STAGE/dist"
cp .mcpbignore       "$STAGE/.mcpbignore"
[[ -f LICENSE ]]   && cp LICENSE   "$STAGE/" || warn "no LICENSE found — consider adding one before release"
[[ -f README.md ]] && cp README.md "$STAGE/"
if [[ -f icon.png ]]; then
  cp icon.png "$STAGE/"
else
  # manifest.json references icon.png; mcpb validate/pack hard-fails if it's
  # missing, so fail here too rather than warn — keeps local builds honest
  # with CI instead of letting a broken bundle slip through.
  fail "no icon.png at repo root — manifest.json references one; mcpb pack will reject the bundle"
fi
ok "staged to $STAGE"

header "3/5  npm ci --omit=dev (production deps only, this is the slow step)"
( cd "$STAGE" && npm ci --omit=dev --no-audit --no-fund --silent )
ok "production node_modules installed"

header "4/5  mcpb validate + pack"
mcpb validate "$STAGE/manifest.json"
mkdir -p releases
OUT="$REPO_ROOT/releases/testingbot-mcp-server-${VERSION}.mcpb"
rm -f "$OUT"
mcpb pack "$STAGE" "$OUT" >/dev/null
SIZE_HUMAN="$(du -h "$OUT" | awk '{print $1}')"
ok "wrote $OUT ($SIZE_HUMAN)"

header "5/5  bundle info"
mcpb info "$OUT" || true

echo
ok "Release artefact ready: $OUT"
echo
color "0" "Next steps:"
color "0" "  • Smoke-test by double-clicking the file — Claude Desktop should prompt for"
color "0" "    TestingBot API key and secret (from manifest.json#user_config), then start."
color "0" "  • Upload to https://github.com/testingbot/mcp-server/releases (or wherever"
color "0" "    your release page lives) so https://testingbot.com/mcp/install can point at it."
