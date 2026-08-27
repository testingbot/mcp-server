import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import addAppAutomateTools from "../../src/tools/app-automate.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("App Automate Tools (Espresso/XCUITest)", () => {
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

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-mcp-appautomate-"));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("uploadAppAutomateApp", () => {
    it("uploads an Espresso apk and returns the project id", async () => {
      const apkPath = path.join(tmpDir, "app.apk");
      fs.writeFileSync(apkPath, "fake-apk");
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 55 }));

      const tools = addAppAutomateTools(serverMock, {}, configMock);
      const result = await tools.uploadAppAutomateApp.handler({
        framework: "espresso",
        localFilePath: apkPath,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Project ID**: 55");
      expect(fetchMock.mock.calls[0][0]).toContain("/espresso/app");
    });

    it("rejects an .apk for XCUITest", async () => {
      const apkPath = path.join(tmpDir, "app.apk");
      fs.writeFileSync(apkPath, "fake-apk");

      const tools = addAppAutomateTools(serverMock, {}, configMock);
      const result = await tools.uploadAppAutomateApp.handler({
        framework: "xcuitest",
        localFilePath: apkPath,
      });

      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("uploadAppAutomateTests", () => {
    it("uploads an XCUITest zip bundle to the project", async () => {
      const zipPath = path.join(tmpDir, "tests.zip");
      fs.writeFileSync(zipPath, "fake-zip");
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 55 }));

      const tools = addAppAutomateTools(serverMock, {}, configMock);
      const result = await tools.uploadAppAutomateTests.handler({
        framework: "xcuitest",
        projectId: 55,
        localFilePath: zipPath,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Test suite uploaded");
      expect(fetchMock.mock.calls[0][0]).toContain("/xcuitest/55/tests");
    });

    it("rejects a zip test suite for Espresso", async () => {
      const zipPath = path.join(tmpDir, "tests.zip");
      fs.writeFileSync(zipPath, "fake-zip");

      const tools = addAppAutomateTools(serverMock, {}, configMock);
      const result = await tools.uploadAppAutomateTests.handler({
        framework: "espresso",
        projectId: 55,
        localFilePath: zipPath,
      });

      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("runAppAutomateTest", () => {
    it("starts an Espresso run with espressoOptions and reports run ids", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ success: true, id: 55, runs: [{ id: 201, capabilities: {} }] })
      );

      const tools = addAppAutomateTools(serverMock, {}, configMock);
      const result = await tools.runAppAutomateTest.handler({
        framework: "espresso",
        projectId: 55,
        deviceName: "Pixel 8",
        realDevice: true,
        testClasses: ["com.example.LoginTest"],
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Run **201**");
      expect(result.content[0].text).toContain("getAppAutomateRunStatus");

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.capabilities[0]).toMatchObject({
        deviceName: "Pixel 8",
        platformName: "Android",
        realDevice: "true",
      });
      expect(body.espressoOptions.class).toEqual(["com.example.LoginTest"]);
    });

    it("starts an XCUITest run using the options key and iOS platform", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ success: true, id: 55, runs: [{ id: 202, capabilities: {} }] })
      );

      const tools = addAppAutomateTools(serverMock, {}, configMock);
      const result = await tools.runAppAutomateTest.handler({
        framework: "xcuitest",
        projectId: 55,
        locale: "fr_FR",
      });

      expect(result.isError).toBeUndefined();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.capabilities[0].platformName).toBe("iOS");
      expect(body.options.locale).toBe("fr_FR");
      expect(body.espressoOptions).toBeUndefined();
    });

    it("surfaces missing-capabilities API errors", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("Missing capabilities", { status: 400 })
      );

      const tools = addAppAutomateTools(serverMock, {}, configMock);
      const result = await tools.runAppAutomateTest.handler({
        framework: "espresso",
        projectId: 55,
      });

      expect(result.isError).toBe(true);
    });
  });

  describe("getAppAutomateRunStatus", () => {
    it("lists project runs when no runId is given", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          success: false,
          completed: false,
          runs: [{ id: 201, status: "READY", success: false, capabilities: { deviceName: "Pixel 8" } }],
        })
      );

      const tools = addAppAutomateTools(serverMock, {}, configMock);
      const result = await tools.getAppAutomateRunStatus.handler({
        framework: "espresso",
        projectId: 55,
      });

      expect(result.content[0].text).toContain("in progress");
      expect(result.content[0].text).toContain("Run 201 — READY");
      expect(fetchMock.mock.calls[0][0]).toMatch(/\/espresso\/55$/);
    });

    it("shows a single run with its session id", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          id: 201,
          status: "DONE",
          success: true,
          test: { sessionId: "abc123", environment: { name: "Pixel 8", version: "14" } },
        })
      );

      const tools = addAppAutomateTools(serverMock, {}, configMock);
      const result = await tools.getAppAutomateRunStatus.handler({
        framework: "espresso",
        projectId: 55,
        runId: 201,
      });

      expect(result.content[0].text).toContain("abc123");
      expect(fetchMock.mock.calls[0][0]).toContain("/espresso/55/201");
    });
  });

  describe("getAppAutomateRunResults", () => {
    it("returns project outcome and the project junit report", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            completed: true,
            runs: [{ id: 201, status: "DONE", success: true }],
          })
        )
        .mockResolvedValueOnce(new Response('<testsuite tests="3"/>', { status: 200 }));

      const tools = addAppAutomateTools(serverMock, {}, configMock);
      const result = await tools.getAppAutomateRunResults.handler({
        framework: "espresso",
        projectId: 55,
      });

      expect(result.content[0].text).toContain("PASSED");
      expect(result.content[0].text).toContain("<testsuite");
      expect(fetchMock.mock.calls[1][0]).toContain("/espresso/55/report");
    });

    it("uses the per-run junit endpoint for xcuitest when runId is given", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ success: true, completed: true, runs: [{ id: 202, status: "DONE", success: true }] })
        )
        .mockResolvedValueOnce(jsonResponse({ junit_report: '<testsuite tests="1"/>' }));

      const tools = addAppAutomateTools(serverMock, {}, configMock);
      const result = await tools.getAppAutomateRunResults.handler({
        framework: "xcuitest",
        projectId: 55,
        runId: 202,
      });

      expect(result.content[0].text).toContain("<testsuite");
      expect(fetchMock.mock.calls[1][0]).toContain("/xcuitest/55/202/junit_report");
    });
  });
});
