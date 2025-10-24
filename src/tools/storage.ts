import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError, validateUrl } from "../lib/utils.js";
import logger from "../lib/logger.js";

export default function addStorageTools(
  server: any,
  testingBotApi: any,
  _config: TestingBotConfig
) {
  const tools: Record<string, any> = {};

  tools.uploadFile = server.tool(
    "uploadFile",
    "Upload a local file (APK, IPA, or ZIP) to TestingBot storage for mobile app testing. Returns an app_url for use in tests.",
    {
      localFilePath: z.string().describe("Local path to the file to upload"),
    },
    async (args: { localFilePath: string }) => {
      try {
        logger.info({ path: args.localFilePath }, "Uploading file");

        const result = await testingBotApi.uploadFile(args.localFilePath);

        return {
          content: [
            {
              type: "text",
              text: `File uploaded successfully!\n\n**App URL**: ${result.app_url}\n\nUse this URL in your test capabilities.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("uploadFile", error);
      }
    }
  );

  tools.uploadRemoteFile = server.tool(
    "uploadRemoteFile",
    "Upload a file from a remote URL to TestingBot storage. The file will be downloaded from the URL and stored.",
    {
      remoteUrl: z.string().url().describe("Remote URL of the file to upload"),
    },
    async (args: { remoteUrl: string }) => {
      try {
        if (!validateUrl(args.remoteUrl)) {
          throw new Error("Invalid URL provided");
        }

        logger.info({ url: args.remoteUrl }, "Uploading remote file");

        const result = await testingBotApi.uploadRemoteFile(args.remoteUrl);

        return {
          content: [
            {
              type: "text",
              text: `Remote file uploaded successfully!\n\n**App URL**: ${result.app_url}\n\nUse this URL in your test capabilities.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("uploadRemoteFile", error);
      }
    }
  );

  tools.getStorageFiles = server.tool(
    "getStorageFiles",
    "List all files in TestingBot storage with pagination.",
    {
      offset: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().min(0))
        .optional()
        .default(0)
        .describe("Offset for pagination (default: 0)"),
      limit: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().min(1).max(100))
        .optional()
        .default(10)
        .describe("Number of files to retrieve (default: 10, max: 100)"),
    },
    async (args: { offset?: number; limit?: number }) => {
      try {
        const offset = Number(args.offset ?? 0);
        const limit = Number(args.limit ?? 10);

        logger.info({ offset, limit }, "Fetching storage files");

        const response = await testingBotApi.getStorageFiles(offset, limit);
        const files = response?.data || [];

        let formattedOutput = `## Storage Files (showing ${limit} from offset ${offset})\n\n`;

        if (files.length > 0) {
          files.forEach((file: any) => {
            formattedOutput += `### ${file.name}\n`;
            formattedOutput += `- **App URL**: ${file.app_url}\n`;
            formattedOutput += `- **Size**: ${(file.size / 1024 / 1024).toFixed(2)} MB\n`;
            formattedOutput += `- **Uploaded**: ${file.uploaded_at}\n`;
            formattedOutput += "\n";
          });
        } else {
          formattedOutput += "No files found in storage.\n";
        }

        return {
          content: [
            {
              type: "text",
              text: formattedOutput,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("getStorageFiles", error);
      }
    }
  );

  tools.deleteStorageFile = server.tool(
    "deleteStorageFile",
    "Delete a file from TestingBot storage using its app_url.",
    {
      appUrl: z.string().describe("The app_url of the file to delete"),
    },
    async (args: { appUrl: string }) => {
      try {
        logger.info({ appUrl: args.appUrl }, "Deleting storage file");

        await testingBotApi.deleteStorageFile(args.appUrl);

        return {
          content: [
            {
              type: "text",
              text: `File deleted successfully from storage.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("deleteStorageFile", error);
      }
    }
  );

  return tools;
}
