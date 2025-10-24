import dotenv from "dotenv";
import { TestingBotConfig } from "./lib/types.js";
import { AuthenticationError } from "./lib/error.js";

dotenv.config();

export function getConfig(): TestingBotConfig {
  const key =
    process.env.TESTINGBOT_KEY || process.env.TB_KEY || process.env.TESTINGBOT_USERNAME || "";
  const secret =
    process.env.TESTINGBOT_SECRET ||
    process.env.TB_SECRET ||
    process.env.TESTINGBOT_ACCESS_KEY ||
    "";

  if (!key || !secret) {
    throw new AuthenticationError(
      "TestingBot credentials not found. Please set TESTINGBOT_KEY and TESTINGBOT_SECRET environment variables."
    );
  }

  return {
    "testingbot-key": key,
    "testingbot-secret": secret,
  };
}
