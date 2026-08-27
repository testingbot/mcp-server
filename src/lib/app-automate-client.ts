import crypto from "crypto";
import fs from "fs";
import path from "path";
import { TestingBotConfig } from "./types.js";
import { getAuth } from "./get-auth.js";

// Minimal REST client for TestingBot's App Automate (Maestro) API.
// These endpoints are not covered by the testingbot-api npm package, so we
// call them directly. Endpoint contract mirrors testingbotctl's Maestro
// provider (https://github.com/testingbot/testingbotctl).
const BASE_URL = "https://api.testingbot.com/v1/app-automate/maestro";
const JSON_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 600_000;

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
    logs?: Record<string, string>;
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
      const result = await this.requestJson("POST", `/app/checksum`, { checksum });
      return result.app_exists && result.id ? Number(result.id) : null;
    } catch {
      return null; // checksum check is an optimization; fall back to upload
    }
  }

  async uploadApp(filePath: string): Promise<{ id: number }> {
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === ".apk"
        ? "application/vnd.android.package-archive"
        : ext === ".zip"
          ? "application/zip"
          : "application/octet-stream";
    return this.uploadFile(`/app`, filePath, contentType);
  }

  async uploadFlowsZip(projectId: number, zipBuffer: Buffer, fileName: string): Promise<unknown> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" }),
      fileName
    );
    return this.submitForm(`/${projectId}/tests`, form);
  }

  async startRun(
    projectId: number,
    capabilities: MaestroCapabilities,
    maestroOptions?: MaestroRunOptions,
    shardSplit?: number
  ): Promise<unknown> {
    return this.requestJson("POST", `/${projectId}/run`, {
      capabilities: [capabilities],
      ...(maestroOptions && Object.keys(maestroOptions).length > 0 && { maestroOptions }),
      ...(shardSplit && { shardSplit }),
    });
  }

  async getProjectStatus(projectId: number): Promise<MaestroProjectStatus> {
    return this.requestJson("GET", `/${projectId}`);
  }

  async getRun(projectId: number, runId: number): Promise<MaestroRunDetails> {
    return this.requestJson("GET", `/${projectId}/${runId}`);
  }

  async getJunitReport(projectId: number, runId: number): Promise<string> {
    const response = await this.rawRequest(
      "GET",
      `/${projectId}/${runId}/junit_report`,
      undefined,
      JSON_TIMEOUT_MS
    );
    return response.text();
  }

  async cancelRun(projectId: number, runId: number): Promise<void> {
    const response = await this.rawRequest(
      "POST",
      `/${projectId}/${runId}/cancel`,
      {},
      JSON_TIMEOUT_MS,
      true
    );
    // 409 means the run already reached a terminal state — treat as success.
    if (!response.ok && response.status !== 409) {
      throw new Error(`Cancel failed with HTTP ${response.status}: ${await response.text()}`);
    }
  }

  async retryRun(projectId: number, runId: number): Promise<unknown> {
    return this.requestJson("POST", `/${projectId}/${runId}/retry`, {});
  }

  async retryFlow(projectId: number, runId: number, flowId: number): Promise<unknown> {
    return this.requestJson("POST", `/${projectId}/${runId}/${flowId}/retry`, {});
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
    const response = await fetch(`${BASE_URL}${endpoint}`, {
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
    const response = await fetch(`${BASE_URL}${endpoint}`, {
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
    if (result && result.success === false) {
      throw new Error(
        result.errors?.join("\n") || result.error || "TestingBot API reported failure"
      );
    }
    return result;
  }
}
