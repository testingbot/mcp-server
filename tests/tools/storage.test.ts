import { describe, it, expect, vi, beforeEach } from "vitest";
import addStorageTools from "../../src/tools/storage.js";

describe("Storage Tools", () => {
  let serverMock: any;
  let testingBotApiMock: any;
  let configMock: any;

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
  });

  describe("uploadFile", () => {
    it("should upload file successfully", async () => {
      const mockResult = {
        app_url: "tb://app123",
      };

      testingBotApiMock.uploadFile.mockResolvedValue(mockResult);

      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.uploadFile.handler({ localFilePath: "/path/to/app.apk" });

      expect(testingBotApiMock.uploadFile).toHaveBeenCalledWith("/path/to/app.apk");
      expect(result.content[0].text).toContain("uploaded successfully");
      expect(result.content[0].text).toContain("tb://app123");
    });

    it("should handle upload errors", async () => {
      testingBotApiMock.uploadFile.mockRejectedValue(new Error("Upload failed"));

      const tools = addStorageTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.uploadFile.handler({ localFilePath: "/path/to/app.apk" });

      expect(result.isError).toBe(true);
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
