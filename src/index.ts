#!/usr/bin/env node

// MUST be first: sets WDIO_LOG_LEVEL before any module pulls in `webdriver`, which
// would otherwise log to stdout and corrupt the stdio JSON-RPC stream. See the
// module for why a plain top-level assignment here is too late (ESM hoisting).
import "./silence-wdio.js";

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
