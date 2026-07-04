// Build the MCP Apps view templates: bundle each view's JS entry (which
// imports the @modelcontextprotocol/ext-apps browser API) into a minified
// IIFE and inline it into the matching HTML template, emitting a single
// self-contained file per view under dist/ui/views/. These are served to MCP
// hosts via resources/read (see src/ui/app-resources.ts).
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";

const VIEWS = ["test-details", "screenshot-gallery"];
const PLACEHOLDER = "/*__VIEW_BUNDLE__*/";
const LOGO_PLACEHOLDER = "<!--__TB_LOGO__-->";

const repoRoot = new URL("../", import.meta.url);
const outDir = new URL("dist/ui/views/", repoRoot);
await mkdir(fileURLToPath(outDir), { recursive: true });

const logoSvg = await readFile(fileURLToPath(new URL("src/ui/views/tb-logo.svg", repoRoot)), "utf8");

for (const view of VIEWS) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`src/ui/views/${view}.js`, repoRoot))],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    write: false,
    legalComments: "none",
  });

  const html = await readFile(fileURLToPath(new URL(`src/ui/views/${view}.html`, repoRoot)), "utf8");
  if (!html.includes(PLACEHOLDER)) {
    throw new Error(`src/ui/views/${view}.html is missing the ${PLACEHOLDER} placeholder`);
  }
  if (!html.includes(LOGO_PLACEHOLDER)) {
    throw new Error(`src/ui/views/${view}.html is missing the ${LOGO_PLACEHOLDER} placeholder`);
  }
  // split/join instead of String.replace: minified JS contains `$` sequences
  // that String.replace would interpret as replacement patterns.
  const out = html
    .split(PLACEHOLDER)
    .join(result.outputFiles[0].text)
    .split(LOGO_PLACEHOLDER)
    .join(logoSvg.trim());
  const outPath = fileURLToPath(new URL(`${view}.html`, outDir));
  await writeFile(outPath, out);
  console.log(`built dist/ui/views/${view}.html (${(out.length / 1024).toFixed(0)} KiB)`);
}
