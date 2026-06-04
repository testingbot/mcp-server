import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getConfig } from "../src/config.js";

const ENV_KEYS = [
  "TESTINGBOT_KEY",
  "TB_KEY",
  "TESTINGBOT_USERNAME",
  "TESTINGBOT_SECRET",
  "TB_SECRET",
  "TESTINGBOT_ACCESS_KEY",
  "TESTINGBOT_CONFIG_DIR",
  "TESTINGBOT_PROFILE",
];

describe("getConfig credential resolution", () => {
  let tmpDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-mcp-config-"));
    process.env.TESTINGBOT_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeCredsFile(profile: string, key: string, secret: string) {
    fs.writeFileSync(
      path.join(tmpDir, "credentials"),
      [`[${profile}]`, `key = ${key}`, `secret = ${secret}`, ""].join("\n")
    );
  }

  it("uses environment variables when both key and secret are present", () => {
    process.env.TESTINGBOT_KEY = "env-key";
    process.env.TESTINGBOT_SECRET = "env-secret";
    writeCredsFile("default", "file-key", "file-secret");

    const config = getConfig();
    expect(config).toEqual({ "testingbot-key": "env-key", "testingbot-secret": "env-secret" });
  });

  it("honors legacy TB_KEY / TB_SECRET aliases", () => {
    process.env.TB_KEY = "legacy-key";
    process.env.TB_SECRET = "legacy-secret";

    const config = getConfig();
    expect(config).toEqual({
      "testingbot-key": "legacy-key",
      "testingbot-secret": "legacy-secret",
    });
  });

  it("falls back to the credentials file when env vars are absent", () => {
    writeCredsFile("default", "file-key", "file-secret");

    const config = getConfig();
    expect(config).toEqual({ "testingbot-key": "file-key", "testingbot-secret": "file-secret" });
  });

  it("falls back to the file when env has a key but no secret (incomplete pair)", () => {
    process.env.TESTINGBOT_KEY = "env-key-only";
    writeCredsFile("default", "file-key", "file-secret");

    const config = getConfig();
    expect(config).toEqual({ "testingbot-key": "file-key", "testingbot-secret": "file-secret" });
  });

  it("reads the profile named by TESTINGBOT_PROFILE", () => {
    process.env.TESTINGBOT_PROFILE = "team";
    writeCredsFile("team", "team-key", "team-secret");

    const config = getConfig();
    expect(config).toEqual({ "testingbot-key": "team-key", "testingbot-secret": "team-secret" });
  });

  it("returns empty credentials (degraded mode) when the requested profile is missing", () => {
    process.env.TESTINGBOT_PROFILE = "nonexistent";
    writeCredsFile("default", "file-key", "file-secret");

    const config = getConfig();
    expect(config).toEqual({ "testingbot-key": "", "testingbot-secret": "" });
  });

  it("returns empty credentials (no throw) when nothing is configured", () => {
    const config = getConfig();
    expect(config).toEqual({ "testingbot-key": "", "testingbot-secret": "" });
  });
});
