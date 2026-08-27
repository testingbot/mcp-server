import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import addMaestroTools from "../../src/tools/maestro.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Maestro Tools", () => {
  let serverMock: any;
  let configMock: any;
  let tmpDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => {
        return { name, desc, schema, handler };
      }),
    };

    configMock = {
      "testingbot-key": "test-key",
      "testingbot-secret": "test-secret",
    };

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-mcp-maestro-"));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("uploadMaestroApp", () => {
    it("uploads a new app and returns the project id", async () => {
      const apkPath = path.join(tmpDir, "app.apk");
      fs.writeFileSync(apkPath, "fake-apk");
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ app_exists: false })) // checksum check
        .mockResolvedValueOnce(jsonResponse({ id: 42 })); // upload

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.uploadMaestroApp.handler({ localFilePath: apkPath });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Project ID**: 42");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toContain("/app/checksum");
      expect(fetchMock.mock.calls[1][0]).toContain("/app");
    });

    it("reuses an existing upload when the checksum matches", async () => {
      const apkPath = path.join(tmpDir, "app.apk");
      fs.writeFileSync(apkPath, "fake-apk");
      fetchMock.mockResolvedValueOnce(jsonResponse({ app_exists: true, id: 7 }));

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.uploadMaestroApp.handler({ localFilePath: apkPath });

      expect(result.content[0].text).toContain("already uploaded");
      expect(result.content[0].text).toContain("Project ID**: 7");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects disallowed extensions without calling the API", async () => {
      const badPath = path.join(tmpDir, "app.exe");
      fs.writeFileSync(badPath, "nope");

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.uploadMaestroApp.handler({ localFilePath: badPath });

      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("uploadMaestroFlows", () => {
    it("zips a directory of yaml flows and uploads it", async () => {
      const flowsDir = path.join(tmpDir, "flows");
      fs.mkdirSync(path.join(flowsDir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(flowsDir, "login.yaml"), "appId: com.example\n---\n- launchApp");
      fs.writeFileSync(path.join(flowsDir, "sub", "helper.yml"), "- tapOn: Next");
      fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.uploadMaestroFlows.handler({ projectId: 42, flowsPath: flowsDir });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Flows uploaded successfully");
      expect(fetchMock.mock.calls[0][0]).toContain("/42/tests");
    });

    it("uploads inline flows", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.uploadMaestroFlows.handler({
        projectId: 42,
        flows: [{ fileName: "smoke.yaml", content: "appId: com.example\n---\n- launchApp" }],
      });

      expect(result.isError).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects inline flows with path traversal names", async () => {
      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.uploadMaestroFlows.handler({
        projectId: 42,
        flows: [{ fileName: "../evil.yaml", content: "x" }],
      });

      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("errors when neither flowsPath nor flows is given", async () => {
      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.uploadMaestroFlows.handler({ projectId: 42 });

      expect(result.isError).toBe(true);
    });
  });

  describe("runMaestroTest", () => {
    it("starts a run and reports run ids without waiting for completion", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          success: true,
          id: 42,
          runs: [{ id: 101, capabilities: { deviceName: "Pixel 8", platformName: "Android" } }],
        })
      );

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.runMaestroTest.handler({
        projectId: 42,
        platformName: "Android",
        deviceName: "Pixel 8",
        realDevice: true,
        env: { USERNAME: "demo" },
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Run **101**");
      expect(result.content[0].text).toContain("getMaestroRunStatus");

      const runBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(runBody.capabilities[0]).toMatchObject({
        deviceName: "Pixel 8",
        platformName: "Android",
        realDevice: "true",
      });
      expect(runBody.maestroOptions.env).toEqual({ USERNAME: "demo" });
    });

    it("passes companion app urls as top-level otherApps", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ success: true, id: 42, runs: [{ id: 104 }] })
      );

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.runMaestroTest.handler({
        projectId: 42,
        platformName: "Android",
        otherApps: ["tb://abc123", "https://example.com/helper.apk"],
      });

      expect(result.isError).toBeUndefined();
      const runBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(runBody.otherApps).toEqual(["tb://abc123", "https://example.com/helper.apk"]);
    });

    it("surfaces API errors returned in a 200 body", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, errors: ["No devices available"] }));

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.runMaestroTest.handler({ projectId: 42, platformName: "Android" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No devices available");
    });
  });

  describe("getMaestroRunStatus", () => {
    it("lists all runs when no runId is given", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          success: true,
          completed: false,
          runs: [
            {
              id: 101,
              status: "READY",
              success: 0,
              flows: [{ id: 1, name: "login", status: "READY" }],
            },
          ],
        })
      );

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.getMaestroRunStatus.handler({ projectId: 42 });

      expect(result.content[0].text).toContain("in progress");
      expect(result.content[0].text).toContain("Run 101 — READY");
      expect(fetchMock.mock.calls[0][0]).toMatch(/\/42$/);
    });

    it("shows a specific run with failures first and suggests results when complete", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          success: true,
          completed: true,
          id: 101,
          status: "FAILED",
          flows: [
            { id: 1, name: "passing", status: "DONE" },
            { id: 2, name: "broken", status: "FAILED", error_messages: ["Element not found"] },
          ],
        })
      );

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.getMaestroRunStatus.handler({ projectId: 42, runId: 101 });

      const text = result.content[0].text;
      expect(text.indexOf("broken")).toBeLessThan(text.indexOf("passing"));
      expect(text).toContain("Element not found");
      expect(text).toContain("getMaestroRunResults");
      expect(fetchMock.mock.calls[0][0]).toContain("/42/101");
    });
  });

  describe("getMaestroRunResults", () => {
    it("returns run outcome and the junit report", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ success: 1, completed: true, id: 101, status: "DONE", flows: [{ id: 1, name: "login", status: "DONE" }] })
        )
        .mockResolvedValueOnce(new Response("<testsuite tests=\"1\"/>", { status: 200 }));

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.getMaestroRunResults.handler({ projectId: 42, runId: 101 });

      expect(result.content[0].text).toContain("PASSED");
      expect(result.content[0].text).toContain("<testsuite");
      expect(fetchMock.mock.calls[1][0]).toContain("/42/101/junit_report");
    });
  });

  describe("uploadMaestroCompanionApp", () => {
    it("uploads a companion app and returns its tb:// url", async () => {
      const apkPath = path.join(tmpDir, "helper.apk");
      fs.writeFileSync(apkPath, "fake-apk");
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 9, app_url: "tb://abc123" }));

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.uploadMaestroCompanionApp.handler({ localFilePath: apkPath });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("tb://abc123");
      expect(result.content[0].text).toContain("otherApps");
      expect(fetchMock.mock.calls[0][0]).toContain("/maestro/other-apps");
    });

    it("rejects disallowed extensions", async () => {
      const badPath = path.join(tmpDir, "helper.exe");
      fs.writeFileSync(badPath, "nope");

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.uploadMaestroCompanionApp.handler({ localFilePath: badPath });

      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("listMaestroProjects", () => {
    it("lists projects with app, flows and run ids", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 42,
              name: "MyApp",
              completed: true,
              app: { bundle_id: "com.example.app", app_version: "1.2" },
              flows: [{ id: 1, name: "login.yaml" }],
              runs: [101, 102],
              created_at: "2026-08-27T09:00:00Z",
            },
          ],
          meta: { offset: 0, count: 10, total: 1 },
        })
      );

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.listMaestroProjects.handler({});

      const text = result.content[0].text;
      expect(text).toContain("Project 42 — MyApp");
      expect(text).toContain("com.example.app v1.2");
      expect(text).toContain("101, 102");
      expect(fetchMock.mock.calls[0][0]).toContain("/maestro?offset=0&count=10");
    });
  });

  describe("listMaestroRuns", () => {
    it("lists recent runs across projects", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 101,
              project_id: 42,
              name: "nightly",
              status: "DONE",
              success: 0,
              capabilities: { deviceName: "Pixel 8" },
              created_at: "2026-08-27T02:00:00Z",
            },
          ],
          meta: { offset: 0, count: 10, total: 1 },
        })
      );

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.listMaestroRuns.handler({});

      const text = result.content[0].text;
      expect(text).toContain("Run **101** (project 42)");
      expect(text).toContain("FAILED");
      expect(text).toContain("Pixel 8");
      expect(fetchMock.mock.calls[0][0]).toContain("/maestro/runs?offset=0&count=10");
    });

    it("looks up runs by build name", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 103, project_id: 42, name: "release-1.2", status: "DONE", success: 1 }],
        })
      );

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.listMaestroRuns.handler({ buildName: "release-1.2" });

      expect(result.content[0].text).toContain("PASSED");
      expect(fetchMock.mock.calls[0][0]).toContain("/maestro/runs/release-1.2");
    });

    it("handles a 404 for an unknown build name", async () => {
      fetchMock.mockResolvedValueOnce(new Response("No Maestro runs found", { status: 404 }));

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.listMaestroRuns.handler({ buildName: "nope" });

      expect(result.isError).toBe(true);
    });
  });

  describe("getMaestroFlowDetails", () => {
    it("returns errors, assets and the step report for a failed flow", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          id: 5,
          name: "checkout",
          status: "FAILED",
          success: 0,
          error_messages: ["Element not found: Buy button"],
          completed_at: "2026-08-27T10:00:00Z",
          report: '<testsuite tests="4" failures="1"/>',
          test: { sessionId: "sess-1", environment: { name: "Pixel 8", version: "14" } },
          assets: {
            video: "https://testingbot.com/video/sess-1.mp4",
            screenshots: ["https://testingbot.com/shot1.png"],
            logs: "https://testingbot.com/logs/sess-1",
          },
          assets_synced: true,
        })
      );

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.getMaestroFlowDetails.handler({
        projectId: 42,
        runId: 101,
        flowId: 5,
      });

      const text = result.content[0].text;
      expect(text).toContain("FAILED");
      expect(text).toContain("Element not found: Buy button");
      expect(text).toContain("sess-1.mp4");
      expect(text).toContain("shot1.png");
      expect(text).toContain('<testsuite tests="4"');
      expect(fetchMock.mock.calls[0][0]).toContain("/42/101/flow/5");
    });

    it("notes when assets are still syncing", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          id: 5,
          name: "checkout",
          status: "DONE",
          success: 1,
          assets_synced: false,
        })
      );

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.getMaestroFlowDetails.handler({
        projectId: 42,
        runId: 101,
        flowId: 5,
      });

      expect(result.content[0].text).toContain("PASSED");
      expect(result.content[0].text).toContain("still syncing");
    });
  });

  describe("cancelMaestroRun", () => {
    it("cancels a run", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.cancelMaestroRun.handler({ projectId: 42, runId: 101 });

      expect(result.content[0].text).toContain("cancelled");
      expect(fetchMock.mock.calls[0][0]).toContain("/42/101/cancel");
    });

    it("treats HTTP 409 (already finished) as success", async () => {
      fetchMock.mockResolvedValueOnce(new Response("conflict", { status: 409 }));

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.cancelMaestroRun.handler({ projectId: 42, runId: 101 });

      expect(result.isError).toBeUndefined();
    });
  });

  describe("retryMaestroRun", () => {
    it("retries a whole run", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.retryMaestroRun.handler({ projectId: 42, runId: 101 });

      expect(result.content[0].text).toContain("Retry queued");
      expect(fetchMock.mock.calls[0][0]).toContain("/42/101/retry");
    });

    it("retries a single flow", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

      const tools = addMaestroTools(serverMock, {}, configMock);
      const result = await tools.retryMaestroRun.handler({ projectId: 42, runId: 101, flowId: 5 });

      expect(result.content[0].text).toContain("flow 5");
      expect(fetchMock.mock.calls[0][0]).toContain("/42/101/5/retry");
    });
  });
});
