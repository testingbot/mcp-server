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

// Configure logger based on debug mode
const logger = pino({
  level: logLevel,
  transport:
    debugToFile && logFilePath
      ? {
          target: "pino-pretty",
          options: {
            colorize: false,
            translateTime: "yyyy-mm-dd HH:MM:ss",
            ignore: "pid,hostname",
            destination: logFilePath,
            mkdir: true,
          },
        }
      : isDevMode
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "HH:MM:ss Z",
              ignore: "pid,hostname",
              destination: 2, // Write to stderr (fd 2) instead of stdout
            },
          }
        : undefined,
});

if (debugToFile && logFilePath) {
  // Log to stderr so it appears in Claude Desktop logs
  console.error(`🐛 Debug logging enabled: ${logFilePath}`);
}

export default logger;
