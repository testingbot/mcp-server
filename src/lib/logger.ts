import pino from "pino";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if debug logging is enabled via environment variable
const debugToFile = process.env.TESTINGBOT_DEBUG === "true";
const isDevMode = process.env.NODE_ENV === "development" || process.argv.includes("--dev");
const logLevel = process.env.LOG_LEVEL || (isDevMode || debugToFile ? "info" : "error");

// Create logs directory if it doesn't exist and debug is enabled
let logFilePath: string | undefined;
if (debugToFile) {
  const logsDir = path.join(__dirname, "../../logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  logFilePath = path.join(logsDir, `debug.log`);
}

// Redact known credential / sensitive fields from any logged object.
const redactPaths = [
  "*.api_key",
  "*.api_secret",
  "*.apiKey",
  "*.apiSecret",
  "*.password",
  "*.authorization",
  "*.Authorization",
  "options.api_key",
  "options.api_secret",
  "args.localFilePath",
  "args.remoteUrl",
  "args.extra",
  "headers.authorization",
];

// MCP servers communicate over stdio — stdout is reserved for JSON-RPC framing.
// All log output MUST go to stderr (fd 2) or a file; never to stdout.
const logger = (() => {
  const base = { level: logLevel, redact: { paths: redactPaths, censor: "[redacted]" } };

  if (debugToFile && logFilePath) {
    return pino({
      ...base,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: false,
          translateTime: "yyyy-mm-dd HH:MM:ss",
          ignore: "pid,hostname",
          destination: logFilePath,
          mkdir: true,
        },
      },
    });
  }

  if (isDevMode) {
    return pino({
      ...base,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss Z",
          ignore: "pid,hostname",
          destination: 2,
        },
      },
    });
  }

  // Production: raw JSON straight to stderr — never stdout.
  return pino(base, pino.destination(2));
})();

if (debugToFile && logFilePath) {
  // Log to stderr so it appears in Claude Desktop logs
  console.error(`🐛 Debug logging enabled: ${logFilePath}`);
}

export default logger;
