#!/usr/bin/env node

// webdriver (via @wdio/logger, pulled in transitively by @testingbot/automation-mcp)
// defaults to level "info" and writes those logs to process.stdout. For a stdio MCP
// server, stdout is reserved exclusively for JSON-RPC framing, so any stray webdriver
// log line corrupts the protocol stream (the client throws "Unexpected non-whitespace
// character after JSON"). Silence it before any import can create a wdio logger —
// @wdio/logger reads WDIO_LOG_LEVEL lazily at getLogger() time, but setting it here,
// above the imports, guarantees it's in place. An operator can still override it.
process.env.WDIO_LOG_LEVEL = process.env.WDIO_LOG_LEVEL || "silent";

import { getConfig } from "./config.js";
import { TestingBotMcpServer } from "./server-factory.js";
import logger from "./lib/logger.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const TestingBot = require("testingbot-api");

async function main() {
  logger.info("Starting TestingBot MCP Server...");

  const config = getConfig();

  const testingBotApi = new TestingBot({
    api_key: config["testingbot-key"],
    api_secret: config["testingbot-secret"],
  });

  const mcpServer = new TestingBotMcpServer(testingBotApi, config);

  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down TestingBot MCP Server");
    try {
      await mcpServer.close();
    } finally {
      process.exit(exitCode);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
    void shutdown("unhandledRejection", 1);
  });
  process.on("uncaughtException", (error) => {
    logger.error({ error }, "Uncaught exception");
    void shutdown("uncaughtException", 1);
  });

  await mcpServer.run();
}

main().catch((error) => {
  logger.error({ error }, "Failed to start server");
  process.exit(1);
});
