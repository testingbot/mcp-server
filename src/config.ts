import dotenv from "dotenv";
import { TestingBotConfig } from "./lib/types.js";
import { loadFromCredentialsFile } from "./lib/credentials.js";

dotenv.config();

function fromEnv(): { key: string; secret: string } {
  const key =
    process.env.TESTINGBOT_KEY || process.env.TB_KEY || process.env.TESTINGBOT_USERNAME || "";
  const secret =
    process.env.TESTINGBOT_SECRET ||
    process.env.TB_SECRET ||
    process.env.TESTINGBOT_ACCESS_KEY ||
    "";
  return { key, secret };
}

// Resolve TestingBot credentials. Precedence, highest first:
//   1. Environment variables (lets CI / MCP-client config override) — both a
//      key and a secret must be present to count.
//   2. The credentials file written by the `tb_login` device-auth tool
//      (~/.testingbot/credentials, profile `default` or $TESTINGBOT_PROFILE).
//   3. Neither: return empty strings. The server then runs in a degraded mode
//      where every tool except `tb_login` reports "Run tb_login to authenticate"
//      — making the first-run experience self-healing rather than a hard crash.
export function getConfig(): TestingBotConfig {
  const env = fromEnv();
  if (env.key && env.secret) {
    return { "testingbot-key": env.key, "testingbot-secret": env.secret };
  }

  const file = loadFromCredentialsFile();
  if (file) {
    return { "testingbot-key": file.key, "testingbot-secret": file.secret };
  }

  return { "testingbot-key": "", "testingbot-secret": "" };
}
