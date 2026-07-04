import { readFile } from "fs/promises";
import { fileURLToPath } from "url";

// MCP Apps (SEP-1865) constants. Values mirror @modelcontextprotocol/ext-apps,
// which is a devDependency only — the server must not import it at runtime.
export const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
export const TEST_DETAILS_RESOURCE_URI = "ui://testingbot/test-details.html";
export const SCREENSHOT_GALLERY_RESOURCE_URI = "ui://testingbot/screenshot-gallery.html";

// TODO(confirm before release): capture real getTestDetails/retrieveScreenshots
// API responses and list the exact origins of test.video, test.thumbs and
// image_url here. Hosts block any origin not listed. No wildcards.
const TB_MEDIA_DOMAINS = ["https://testingbot.com"];

interface UiResourceDef {
  uri: string;
  name: string;
  description: string;
  file: string;
  csp?: { connectDomains?: string[]; resourceDomains?: string[] };
}

const UI_RESOURCES: UiResourceDef[] = [
  {
    uri: TEST_DETAILS_RESOURCE_URI,
    name: "TestingBot Test Details",
    description:
      "Interactive dashboard for a TestingBot test: status, video playback, screenshots and logs.",
    file: "test-details.html",
    csp: { resourceDomains: TB_MEDIA_DOMAINS },
  },
  {
    uri: SCREENSHOT_GALLERY_RESOURCE_URI,
    name: "TestingBot Screenshot Gallery",
    description: "Cross-browser screenshot gallery with click-to-enlarge previews.",
    file: "screenshot-gallery.html",
    csp: { resourceDomains: TB_MEDIA_DOMAINS },
  },
];

const htmlCache = new Map<string, string>();

// Views are built by scripts/build-ui.mjs into dist/ui/views/. This module
// compiles to dist/ui/app-resources.js, so the first candidate covers every
// packaged runtime (npm, npx, .mcpb). The env override exists for tests, which
// run before tsc/build:ui and so cannot depend on dist/. The last candidate
// covers tsx-driven dev, where this module executes from src/ui/.
async function loadViewHtml(file: string): Promise<string> {
  const cached = htmlCache.get(file);
  if (cached) return cached;

  const candidates = [
    ...(process.env.TESTINGBOT_UI_DIR
      ? [new URL(file, `file://${process.env.TESTINGBOT_UI_DIR}/`)]
      : []),
    new URL(`./views/${file}`, import.meta.url),
    new URL(`../../dist/ui/views/${file}`, import.meta.url),
  ];

  for (const url of candidates) {
    try {
      const html = await readFile(fileURLToPath(url), "utf8");
      htmlCache.set(file, html);
      return html;
    } catch {
      // try next candidate
    }
  }

  throw new Error(`UI view "${file}" not built — run "npm run build:ui" first`);
}

export function listUiResources() {
  return {
    resources: UI_RESOURCES.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: RESOURCE_MIME_TYPE,
      ...(r.csp ? { _meta: { ui: { csp: r.csp } } } : {}),
    })),
  };
}

export async function readUiResource(uri: string) {
  const def = UI_RESOURCES.find((r) => r.uri === uri);
  if (!def) {
    throw new Error(`Resource not found: ${uri}`);
  }
  return {
    contents: [
      {
        uri,
        mimeType: RESOURCE_MIME_TYPE,
        text: await loadViewHtml(def.file),
        ...(def.csp ? { _meta: { ui: { csp: def.csp } } } : {}),
      },
    ],
  };
}
