import { z } from "zod";
import path from "path";
import fs from "fs";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

const ALLOWED_UPLOAD_EXTENSIONS = new Set([".apk", ".ipa", ".zip"]);

// Validate a local file path before handing it to the upload API.
// Rejects: relative paths that can't be resolved, hidden files, disallowed extensions,
// missing files, and non-regular files.
function validateLocalUploadPath(input: string): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("File path must be a non-empty string");
  }

  const resolved = path.resolve(input);
  const base = path.basename(resolved);

  if (base.startsWith(".")) {
    throw new Error("Hidden files (dotfiles) are not allowed");
  }

  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    throw new Error(
      `Only ${[...ALLOWED_UPLOAD_EXTENSIONS].join(", ")} files may be uploaded (got "${ext || "no extension"}")`
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`File not found or not readable: ${resolved}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Path is not a regular file: ${resolved}`);
  }

  return resolved;
}

// Block common SSRF targets: loopback, link-local (incl. cloud metadata 169.254.169.254),
// RFC1918 private ranges, IPv6 loopback / unique-local / link-local, and "localhost".
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::" || host === "::1") return true;

  // IPv4 literal
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local incl. metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 0) return true;
    return false;
  }

  // IPv6 literal (rough but covers the common bad ranges)
  if (host.includes(":")) {
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique-local
    if (host.startsWith("fe80")) return true; // link-local
    if (host === "::1") return true;
  }

  return false;
}

function validateRemoteUploadUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`URL protocol must be http or https (got "${parsed.protocol}")`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL must not contain embedded credentials");
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Host "${parsed.hostname}" is not allowed (private / loopback / link-local)`);
  }

  return parsed.toString();
}

export default function addStorageTools(
  server: any,
  testingBotApi: any,
  _config: TestingBotConfig
) {
  const tools: Record<string, any> = {};

  tools.uploadFile = server.tool(
    "uploadFile",
    "Upload a local app file (.apk, .ipa or .zip) to TestingBot storage and return its `tb://` app URL, to use as `appium:app` in a native-app session (appium_session_management). Each call stores a new copy; list existing uploads with getStorageFiles to reuse one. For a file on the web use uploadRemoteFile; Maestro and Espresso/XCUITest have their own upload tools.",
    {
      localFilePath: z.string().describe("Local path to the file to upload"),
    },
    async (args: { localFilePath: string }) => {
      try {
        const safePath = validateLocalUploadPath(args.localFilePath);
        logger.info({ path: safePath }, "Uploading file");

        const result = await testingBotApi.uploadFile(safePath);

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
    "Have TestingBot download an app file (.apk, .ipa or .zip) from a public http(s) URL into its storage, and return its `tb://` app URL for `appium:app`. Use it when the build is on a web server or CI artifact URL instead of this machine (for local files use uploadFile). The URL must be reachable from the internet without login. Each call stores a new copy.",
    {
      remoteUrl: z.string().url().describe("Remote URL of the file to upload"),
    },
    async (args: { remoteUrl: string }) => {
      try {
        const safeUrl = validateRemoteUploadUrl(args.remoteUrl);

        logger.info({ url: safeUrl }, "Uploading remote file");

        const result = await testingBotApi.uploadRemoteFile(safeUrl);

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
    "List the app files in the account's TestingBot storage, newest first, with each file's name, `tb://` app URL, type, version and upload time. Read-only. Use it to reuse an uploaded app instead of uploading it again, or to find the app URL for deleteStorageFile. Paginate with `offset` / `limit` (default 10, max 100).",
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

        let formattedOutput = `## Storage Files (showing ${files.length} from offset ${offset})\n\n`;

        if (files.length > 0) {
          // GET /v1/storage returns filename/type/version/created_at (no name, size or uploaded_at)
          files.forEach((file: any) => {
            formattedOutput += `### ${file.filename || file.app_url}\n`;
            formattedOutput += `- **App URL**: ${file.app_url}\n`;
            if (file.type) formattedOutput += `- **Type**: ${file.type}\n`;
            if (file.version) formattedOutput += `- **Version**: ${file.version}\n`;
            if (file.sim_only !== undefined && file.sim_only !== null)
              formattedOutput += `- **Simulator only**: ${file.sim_only ? "yes" : "no"}\n`;
            formattedOutput += `- **Uploaded**: ${file.created_at}\n`;
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
    "Permanently delete an uploaded app file from TestingBot storage. Sessions and runs that still reference its app URL will fail to install it. This cannot be undone; only call it when the user asked to delete that file. Get the exact `appUrl` (tb://...) from getStorageFiles. Returns a confirmation, or an error if no file has that URL.",
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
