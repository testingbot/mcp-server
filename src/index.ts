#!/usr/bin/env node

import { getConfig } from "./config.js";
import { TestingBotMcpServer } from "./server-factory.js";
import logger from "./lib/logger.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const TestingBot = require("testingbot-api");

async function main() {
  try {
    logger.info("Starting TestingBot MCP Server...");

    const config = getConfig();

    const testingBotApi = new TestingBot({
      api_key: config["testingbot-key"],
      api_secret: config["testingbot-secret"],
    });

    const mcpServer = new TestingBotMcpServer(testingBotApi, config);
    await mcpServer.run();
  } catch (error) {
    logger.error({ error }, "Failed to start server");
    console.error("Error starting TestingBot MCP Server:", error);
    process.exit(1);
  }
}

main();
