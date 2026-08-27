import crypto from "crypto";
import fs from "fs";
import path from "path";
import { TestingBotConfig } from "./types.js";
import { getAuth } from "./get-auth.js";

// Minimal REST client for TestingBot's App Automate (Maestro, Espresso,
// XCUITest) API. These endpoints are not covered by the testingbot-api npm
// package, so we call them directly. Endpoint contract mirrors
// testingbotctl's providers (https://github.com/testingbot/testingbotctl).
const APP_AUTOMATE_URL = "https://api.testingbot.com/v1/app-automate";
const JSON_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 600_000;

export type AppAutomateFramework = "espresso" | "xcuitest";

export interface MaestroCapabilities {
  deviceName: string;
  platformName: "Android" | "iOS";
  version?: string;
  name?: string;
  realDevice?: string;
  [key: string]: unknown;
}

export interface MaestroRunOptions {
  env?: Record<string, string>;
  includeTags?: string[];
  excludeTags?: string[];
  version?: string;
}

export interface MaestroFlowInfo {
  id: number;
  name: string;
  status: "WAITING" | "READY" | "DONE" | "FAILED" | "CANCELLED";
  success?: number;
  shard_index?: number;
  error_messages?: string[];
  assets?: {
    logs?: Record<string, string> | string;
    video?: string | false;
    screenshots?: string[];
  };
}

export interface MaestroRunInfo {
  id: number;
  status: "WAITING" | "READY" | "DONE" | "FAILED" | "CANCELLED";
  capabilities?: { deviceName: string; platformName: string; version?: string };
  environment?: { device?: string; name?: string; version?: string };
  success: number;
  flows?: MaestroFlowInfo[];
  error_messages?: string[];
}

export interface MaestroProjectStatus {
  runs: MaestroRunInfo[];
  success: boolean;
  completed: boolean;
}

export interface MaestroRunDetails extends MaestroRunInfo {
  completed: boolean;
}

// GET /:project_id/:run_id/flow/:flow_id — per-flow result with step-level
// JUnit report and asset links (see MaestroRunTest#json_payload in web).
export interface MaestroFlowResult extends MaestroFlowInfo {
  maestro_flow_id?: number;
  test_case_id?: number;
  report?: string;
  requested_at?: string;
  completed_at?: string;
  test?: {
    sessionId?: string;
    environment?: { name?: string; os?: string; version?: string };
  };
  assets_synced?: boolean;
}

export interface MaestroRunStarted {
  success: boolean;
  id: number;
  runs?: Array<{ id: number; capabilities?: Record<string, unknown>; flows?: MaestroFlowInfo[] }>;
}

// Espresso and XCUITest share one project/run shape (see the Grape API:
// app_automate_espresso_api.rb / app_automate_xcuitest_api.rb in web).
export interface FrameworkCapabilities {
  deviceName: string;
  platformName: "Android" | "iOS";
  version?: string;
  name?: string;
  build?: string;
  realDevice?: string;
  [key: string]: unknown;
}

export interface FrameworkRunInfo {
  id: number;
  created_at?: string;
  status: string;
  capabilities?: Record<string, unknown>;
  success: boolean;
  report?: string;
  test?: {
    sessionId?: string;
    environment?: { name?: string; os?: string; version?: string };
  };
}

export interface FrameworkProjectStatus {
  runs: FrameworkRunInfo[];
  success: boolean;
  completed: boolean;
}

export interface FrameworkRunStarted {
  success: boolean;
  id: number;
  runs: Array<{ id: number; capabilities?: Record<string, unknown> }>;
}

export class AppAutomateClient {
  private authHeader: string;

  constructor(config: TestingBotConfig) {
    const { username, password } = getAuth(config);
    this.authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  }

  static md5Checksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("base64")));
      stream.on("error", reject);
    });
  }

  // POST /app/checksum — returns the existing project id if this exact app
  // binary was uploaded before, so re-runs skip the upload entirely.
  async findAppByChecksum(checksum: string): Promise<number | null> {
    try {
      const result = await this.requestJson("POST", `/maestro/app/checksum`, { checksum });
      return result.app_exists && result.id ? Number(result.id) : null;
    } catch {
      return null; // checksum check is an optimization; fall back to upload
    }
  }

  async uploadApp(filePath: string): Promise<{ id: number }> {
    return this.uploadFile(`/maestro/app`, filePath, this.contentTypeFor(filePath));
  }

  async uploadFlowsZip(projectId: number, zipBuffer: Buffer, fileName: string): Promise<unknown> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" }),
      fileName
    );
    return this.submitForm(`/maestro/${projectId}/tests`, form);
  }

  async startRun(
    projectId: number,
    capabilities: MaestroCapabilities,
    maestroOptions?: MaestroRunOptions,
    shardSplit?: number
  ): Promise<MaestroRunStarted> {
    return this.requestJson("POST", `/maestro/${projectId}/run`, {
      capabilities: [capabilities],
      ...(maestroOptions && Object.keys(maestroOptions).length > 0 && { maestroOptions }),
      ...(shardSplit && { shardSplit }),
    });
  }

  async getProjectStatus(projectId: number): Promise<MaestroProjectStatus> {
    return this.requestJson("GET", `/maestro/${projectId}`);
  }

  async getRun(projectId: number, runId: number): Promise<MaestroRunDetails> {
    return this.requestJson("GET", `/maestro/${projectId}/${runId}`);
  }

  async getJunitReport(projectId: number, runId: number): Promise<string> {
    const response = await this.rawRequest(
      "GET",
      `/maestro/${projectId}/${runId}/junit_report`,
      undefined,
      JSON_TIMEOUT_MS
    );
    return response.text();
  }

  async cancelRun(projectId: number, runId: number): Promise<void> {
    const response = await this.rawRequest(
      "POST",
      `/maestro/${projectId}/${runId}/cancel`,
      {},
      JSON_TIMEOUT_MS,
      true
    );
    // 409 means the run already reached a terminal state — treat as success.
    if (!response.ok && response.status !== 409) {
      throw new Error(`Cancel failed with HTTP ${response.status}: ${await response.text()}`);
    }
  }

  async getFlowResult(
    projectId: number,
    runId: number,
    flowId: number
  ): Promise<MaestroFlowResult> {
    return this.requestJson("GET", `/maestro/${projectId}/${runId}/flow/${flowId}`);
  }

  async retryRun(projectId: number, runId: number): Promise<unknown> {
    return this.requestJson("POST", `/maestro/${projectId}/${runId}/retry`, {});
  }

  async retryFlow(projectId: number, runId: number, flowId: number): Promise<unknown> {
    return this.requestJson("POST", `/maestro/${projectId}/${runId}/${flowId}/retry`, {});
  }

  // --- Espresso / XCUITest (shared endpoint shape, no checksum/cancel/retry) ---

  async uploadFrameworkApp(
    framework: AppAutomateFramework,
    filePath: string
  ): Promise<{ id: number }> {
    return this.uploadFile(`/${framework}/app`, filePath, this.contentTypeFor(filePath));
  }

  async uploadFrameworkTests(
    framework: AppAutomateFramework,
    projectId: number,
    filePath: string
  ): Promise<{ id: number }> {
    return this.uploadFile(
      `/${framework}/${projectId}/tests`,
      filePath,
      this.contentTypeFor(filePath)
    );
  }

  // Espresso expects its options under `espressoOptions`; XCUITest under `options`.
  async startFrameworkRun(
    framework: AppAutomateFramework,
    projectId: number,
    capabilities: FrameworkCapabilities,
    options?: Record<string, unknown>
  ): Promise<FrameworkRunStarted> {
    const optionsKey = framework === "espresso" ? "espressoOptions" : "options";
    return this.requestJson("POST", `/${framework}/${projectId}/run`, {
      capabilities: [capabilities],
      ...(options && Object.keys(options).length > 0 && { [optionsKey]: options }),
    });
  }

  async getFrameworkProject(
    framework: AppAutomateFramework,
    projectId: number
  ): Promise<FrameworkProjectStatus> {
    return this.requestJson("GET", `/${framework}/${projectId}`);
  }

  async getFrameworkRun(
    framework: AppAutomateFramework,
    projectId: number,
    runId: number
  ): Promise<FrameworkRunInfo> {
    return this.requestJson("GET", `/${framework}/${projectId}/${runId}`);
  }

  // Project-level JUnit XML report (all runs). XCUITest additionally has a
  // per-run junit_report endpoint; Espresso does not.
  async getFrameworkProjectReport(
    framework: AppAutomateFramework,
    projectId: number
  ): Promise<string> {
    const response = await this.rawRequest(
      "GET",
      `/${framework}/${projectId}/report`,
      undefined,
      JSON_TIMEOUT_MS
    );
    return response.text();
  }

  async getXcuitestRunJunitReport(projectId: number, runId: number): Promise<string> {
    const result = await this.requestJson("GET", `/xcuitest/${projectId}/${runId}/junit_report`);
    return result.junit_report ?? "";
  }

  private contentTypeFor(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".apk") return "application/vnd.android.package-archive";
    if (ext === ".zip") return "application/zip";
    return "application/octet-stream";
  }

  private async uploadFile(
    endpoint: string,
    filePath: string,
    contentType: string
  ): Promise<{ id: number }> {
    const buffer = await fs.promises.readFile(filePath);
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: contentType }),
      path.basename(filePath)
    );
    return this.submitForm(endpoint, form) as Promise<{ id: number }>;
  }

  private async submitForm(endpoint: string, form: FormData): Promise<unknown> {
    const response = await fetch(`${APP_AUTOMATE_URL}${endpoint}`, {
      method: "POST",
      headers: { Authorization: this.authHeader },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    return this.parseResponse(response);
  }

  private async requestJson(method: string, endpoint: string, body?: unknown): Promise<any> {
    const response = await this.rawRequest(method, endpoint, body, JSON_TIMEOUT_MS);
    return this.parseResponse(response);
  }

  private async rawRequest(
    method: string,
    endpoint: string,
    body: unknown | undefined,
    timeoutMs: number,
    allowErrorStatus = false
  ): Promise<Response> {
    const response = await fetch(`${APP_AUTOMATE_URL}${endpoint}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok && !allowErrorStatus) {
      const text = await response.text().catch(() => "");
      throw new Error(`TestingBot API returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return response;
  }

  private async parseResponse(response: Response): Promise<any> {
    const result = await response.json();
    // The API can report failures inside a 200 body as { success: false, errors: [...] }.
    // Note: status endpoints also carry a `success` field meaning "all runs
    // passed" — only treat it as an error when an error payload accompanies it.
    if (result && result.success === false && (result.errors || result.error)) {
      throw new Error(
        result.errors?.join("\n") || result.error || "TestingBot API reported failure"
      );
    }
    return result;
  }
}
