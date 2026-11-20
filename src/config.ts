import dotenv from "dotenv";
import { TestingBotConfig } from "./lib/types.js";
import { loadFromCredentialsFile } from "./lib/credentials.js";

dotenv.config();

// A value is unusable when it is empty or an unsubstituted template such as
// `${user_config.testingbot-key}` (a .mcpb install whose optional fields were
// left blank) or `${input:TESTINGBOT_KEY}`. Treating those as credentials would
// override the tb_login file with a key TestingBot rejects.
function usable(value: string | undefined): string {
  const v = value?.trim() ?? "";
  return /^\$\{[^}]*\}$/.test(v) ? "" : v;
}

function fromEnv(): { key: string; secret: string } {
  const key =
    usable(process.env.TESTINGBOT_KEY) ||
    usable(process.env.TB_KEY) ||
    usable(process.env.TESTINGBOT_USERNAME);
  const secret =
    usable(process.env.TESTINGBOT_SECRET) ||
    usable(process.env.TB_SECRET) ||
    usable(process.env.TESTINGBOT_ACCESS_KEY);
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
