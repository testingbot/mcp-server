import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  listUiResources,
  readUiResource,
  RESOURCE_MIME_TYPE,
  TEST_DETAILS_RESOURCE_URI,
  SCREENSHOT_GALLERY_RESOURCE_URI,
} from "../src/ui/app-resources.js";

describe("MCP Apps UI resources", () => {
  describe("listUiResources", () => {
    it("lists both views with the MCP Apps mime type", () => {
      const { resources } = listUiResources();

      expect(resources).toHaveLength(2);
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain(TEST_DETAILS_RESOURCE_URI);
      expect(uris).toContain(SCREENSHOT_GALLERY_RESOURCE_URI);

      for (const resource of resources) {
        expect(resource.uri).toMatch(/^ui:\/\//);
        expect(resource.mimeType).toBe("text/html;profile=mcp-app");
        expect(resource.mimeType).toBe(RESOURCE_MIME_TYPE);
        // Views load screenshots/video from TestingBot — the CSP allow-list
        // must never be empty or hosts will block all media.
        const csp = (resource as any)._meta?.ui?.csp;
        expect(csp?.resourceDomains?.length).toBeGreaterThan(0);
      }
    });
  });

  describe("readUiResource", () => {
    let uiDir: string;

    beforeEach(async () => {
      // Tests run before tsc/build:ui, so dist/ may not exist. The loader's
      // env override points it at a stub build output instead.
      uiDir = await mkdtemp(path.join(tmpdir(), "tb-ui-"));
      await writeFile(path.join(uiDir, "test-details.html"), "<html>test-details stub</html>");
      process.env.TESTINGBOT_UI_DIR = uiDir;
    });

    afterEach(async () => {
      delete process.env.TESTINGBOT_UI_DIR;
      await rm(uiDir, { recursive: true, force: true });
    });

    it("serves the built HTML with mime type and CSP metadata", async () => {
      const result = await readUiResource(TEST_DETAILS_RESOURCE_URI);

      expect(result.contents).toHaveLength(1);
      const content = result.contents[0] as any;
      expect(content.uri).toBe(TEST_DETAILS_RESOURCE_URI);
      expect(content.mimeType).toBe(RESOURCE_MIME_TYPE);
      expect(content.text).toBe("<html>test-details stub</html>");
      expect(content._meta.ui.csp.resourceDomains.length).toBeGreaterThan(0);
    });

    it("rejects unknown resource URIs", async () => {
      await expect(readUiResource("ui://testingbot/nope.html")).rejects.toThrow(
        "Resource not found"
      );
    });
  });
});
