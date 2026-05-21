#!/usr/bin/env node
// Mirrors package.json#version into manifest.json and server.json so MCPB
// bundles and the MCP registry entry never drift from the npm release.
// Run modes:
//   node scripts/sync-version.mjs          → rewrite files in place
//   node scripts/sync-version.mjs --check  → exit non-zero on drift (CI gate)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const version = pkg.version;
if (!version) {
  console.error("sync-version: package.json has no version field");
  process.exit(1);
}

const targets = [
  {
    path: resolve(repoRoot, "manifest.json"),
    apply: (data) => {
      data.version = version;
      return data;
    },
  },
  {
    path: resolve(repoRoot, "server.json"),
    apply: (data) => {
      data.version = version;
      if (Array.isArray(data.packages)) {
        data.packages.forEach((p) => {
          p.version = version;
        });
      }
      return data;
    },
  },
];

let drift = false;
for (const { path, apply } of targets) {
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw);
  const next = apply(structuredClone(data));
  const nextRaw = JSON.stringify(next, null, 2) + "\n";

  if (raw === nextRaw) continue;

  if (checkOnly) {
    drift = true;
    console.error(`sync-version: ${path} is out of sync with package.json (${version})`);
  } else {
    writeFileSync(path, nextRaw);
    console.log(`sync-version: updated ${path} → ${version}`);
  }
}

if (checkOnly && drift) {
  console.error("\nRun `npm run version:sync` to fix.");
  process.exit(1);
}
