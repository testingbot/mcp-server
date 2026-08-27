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
