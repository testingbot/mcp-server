import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import addStorageTools from "../../src/tools/storage.js";

describe("Storage Tools", () => {
  let serverMock: any;
  let testingBotApiMock: any;
  let configMock: any;
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();

    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => {
        return { name, desc, schema, handler };
      }),
    };

    testingBotApiMock = {
      uploadFile: vi.fn(),
      uploadRemoteFile: vi.fn(),
      getStorageFiles: vi.fn(),
      deleteStorageFile: vi.fn(),
    };

    configMock = {
      "testingbot-key": "test-key",
      "testingbot-secret": "test-secret",
    };

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-mcp-storage-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("uploadFile", () => {
    it("should upload an allowed file successfully", async () => {
      const apkPath = path.join(tmpDir, "app.apk");
      fs.writeFileSync(apkPath, "fake-apk");
      testingBotApiMock.uploadFile.mockResolvedValue({ app_url: "tb://app123" });

      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.uploadFile.handler({ localFilePath: apkPath });

      expect(testingBotApiMock.uploadFile).toHaveBeenCalledWith(path.resolve(apkPath));
      expect(result.content[0].text).toContain("uploaded successfully");
      expect(result.content[0].text).toContain("tb://app123");
    });

    it("should handle upload errors", async () => {
      const apkPath = path.join(tmpDir, "app.apk");
      fs.writeFileSync(apkPath, "fake-apk");
      testingBotApiMock.uploadFile.mockRejectedValue(new Error("Upload failed"));

      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.uploadFile.handler({ localFilePath: apkPath });

      expect(result.isError).toBe(true);
    });

    it("should reject disallowed extensions", async () => {
      const badPath = path.join(tmpDir, "secret.env");
      fs.writeFileSync(badPath, "SECRET=1");

      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.uploadFile.handler({ localFilePath: badPath });

      expect(result.isError).toBe(true);
      expect(testingBotApiMock.uploadFile).not.toHaveBeenCalled();
    });

    it("should reject dotfiles even with allowed extension", async () => {
      const dotPath = path.join(tmpDir, ".hidden.apk");
      fs.writeFileSync(dotPath, "fake");

      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.uploadFile.handler({ localFilePath: dotPath });

      expect(result.isError).toBe(true);
      expect(testingBotApiMock.uploadFile).not.toHaveBeenCalled();
    });

    it("should reject missing files", async () => {
      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.uploadFile.handler({
        localFilePath: path.join(tmpDir, "missing.apk"),
      });

      expect(result.isError).toBe(true);
      expect(testingBotApiMock.uploadFile).not.toHaveBeenCalled();
    });

    it("should reject directories", async () => {
      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.uploadFile.handler({ localFilePath: tmpDir });

      expect(result.isError).toBe(true);
      expect(testingBotApiMock.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe("uploadRemoteFile", () => {
    it("should upload remote file successfully", async () => {
      const mockResult = {
        app_url: "tb://app456",
      };

      testingBotApiMock.uploadRemoteFile.mockResolvedValue(mockResult);

      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.uploadRemoteFile.handler({
        remoteUrl: "https://example.com/app.apk",
      });

      expect(testingBotApiMock.uploadRemoteFile).toHaveBeenCalledWith(
        "https://example.com/app.apk"
      );
      expect(result.content[0].text).toContain("Remote file uploaded successfully");
      expect(result.content[0].text).toContain("tb://app456");
    });

    it("should reject invalid URLs", async () => {
      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.uploadRemoteFile.handler({ remoteUrl: "not-a-url" });

      expect(result.isError).toBe(true);
      expect(testingBotApiMock.uploadRemoteFile).not.toHaveBeenCalled();
    });

    it.each([
      ["file URI", "file:///etc/passwd"],
      ["AWS metadata IP", "http://169.254.169.254/latest/meta-data/"],
      ["loopback IPv4", "http://127.0.0.1/"],
      ["loopback IPv6", "http://[::1]/"],
      ["RFC1918 10.x", "http://10.0.0.1/payload.zip"],
      ["RFC1918 192.168.x", "http://192.168.1.1/x"],
      ["RFC1918 172.16.x", "http://172.16.5.4/x"],
      ["localhost", "http://localhost:8080/"],
      ["credentials in URL", "https://user:pass@example.com/"],
      ["gopher protocol", "gopher://example.com/"],
    ])("should reject SSRF target: %s", async (_label, url) => {
      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.uploadRemoteFile.handler({ remoteUrl: url });

      expect(result.isError).toBe(true);
      expect(testingBotApiMock.uploadRemoteFile).not.toHaveBeenCalled();
    });
  });

  describe("getStorageFiles", () => {
    it("should list storage files", async () => {
      const mockFiles = [
        {
          app_url: "tb://app123",
          name: "app1.apk",
          size: 5242880,
          uploaded_at: "2025-01-01T00:00:00Z",
        },
        {
          app_url: "tb://app456",
          name: "app2.ipa",
          size: 10485760,
          uploaded_at: "2025-01-02T00:00:00Z",
        },
      ];

      testingBotApiMock.getStorageFiles.mockResolvedValue({ data: mockFiles, meta: {} });

      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getStorageFiles.handler({ offset: 0, limit: 10 });

      expect(testingBotApiMock.getStorageFiles).toHaveBeenCalledWith(0, 10);
      expect(result.content[0].text).toContain("app1.apk");
      expect(result.content[0].text).toContain("app2.ipa");
      expect(result.content[0].text).toContain("5.00 MB");
      expect(result.content[0].text).toContain("10.00 MB");
    });

    it("should handle empty storage", async () => {
      testingBotApiMock.getStorageFiles.mockResolvedValue({ data: [], meta: {} });

      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.getStorageFiles.handler({});

      expect(result.content[0].text).toContain("No files found in storage");
    });
  });

  describe("deleteStorageFile", () => {
    it("should delete file successfully", async () => {
      testingBotApiMock.deleteStorageFile.mockResolvedValue({});

      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.deleteStorageFile.handler({ appUrl: "tb://app123" });

      expect(testingBotApiMock.deleteStorageFile).toHaveBeenCalledWith("tb://app123");
      expect(result.content[0].text).toContain("deleted successfully");
    });
  });
});
