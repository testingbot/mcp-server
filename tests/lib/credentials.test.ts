import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  parseCredentialsIni,
  loadFromCredentialsFile,
  writeCredentialsFile,
  credentialsPath,
  credentialsDir,
} from "../../src/lib/credentials.js";

const ENV_KEYS = ["TESTINGBOT_CONFIG_DIR", "TESTINGBOT_PROFILE"];

describe("lib/credentials", () => {
  let tmpDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-mcp-creds-"));
    process.env.TESTINGBOT_CONFIG_DIR = tmpDir;
    delete process.env.TESTINGBOT_PROFILE;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // parseCredentialsIni
  // ---------------------------------------------------------------------------

  describe("parseCredentialsIni", () => {
    it("parses sections and key/value pairs", () => {
      const parsed = parseCredentialsIni(
        ["[default]", "key = abc", "secret = def", "", "[team]", "key = ghi", "secret = jkl"].join(
          "\n"
        )
      );
      expect(parsed.default).toEqual({ key: "abc", secret: "def" });
      expect(parsed.team).toEqual({ key: "ghi", secret: "jkl" });
    });

    it("ignores comments and blank lines", () => {
      const parsed = parseCredentialsIni(
        ["# a comment", "; another", "", "[default]", "  key = abc  ", "secret=def"].join("\n")
      );
      expect(parsed.default).toEqual({ key: "abc", secret: "def" });
    });

    it("keeps values that themselves contain '='", () => {
      const parsed = parseCredentialsIni(["[default]", "secret = a=b=c"].join("\n"));
      expect(parsed.default.secret).toBe("a=b=c");
    });

    it("drops key/value lines that appear before any section", () => {
      const parsed = parseCredentialsIni(["key = orphan", "[default]", "key = abc"].join("\n"));
      expect(parsed.default).toEqual({ key: "abc" });
    });
  });

  // ---------------------------------------------------------------------------
  // writeCredentialsFile + loadFromCredentialsFile round trip
  // ---------------------------------------------------------------------------

  describe("writeCredentialsFile", () => {
    const creds = {
      client_key: "deadbeef",
      client_secret: "cafebabe",
      user: { email: "ada@example.com", id: 7 },
    };

    it("writes the file mode 0600 inside a 0700 directory", () => {
      const written = writeCredentialsFile(creds);
      expect(written).toBe(credentialsPath());

      const fileStat = fs.statSync(written);
      const dirStat = fs.statSync(credentialsDir());
      // POSIX permission bits.
      expect(fileStat.mode & 0o777).toBe(0o600);
      expect(dirStat.mode & 0o777).toBe(0o700);
    });

    it("writes a readable INI body with the account comment", () => {
      writeCredentialsFile(creds);
      const body = fs.readFileSync(credentialsPath(), "utf8");
      expect(body).toContain("[default]");
      expect(body).toContain("key = deadbeef");
      expect(body).toContain("secret = cafebabe");
      expect(body).toContain("# Account: ada@example.com");
    });

    it("round-trips through loadFromCredentialsFile", () => {
      writeCredentialsFile(creds);
      const loaded = loadFromCredentialsFile();
      expect(loaded).toEqual({ key: "deadbeef", secret: "cafebabe" });
    });

    it("writes to the active (non-default) profile when TESTINGBOT_PROFILE is set", () => {
      process.env.TESTINGBOT_PROFILE = "team";
      writeCredentialsFile(creds);
      const body = fs.readFileSync(credentialsPath(), "utf8");
      expect(body).toContain("[team]");
      expect(loadFromCredentialsFile("team")).toEqual({ key: "deadbeef", secret: "cafebabe" });
    });

    it("preserves other profiles when writing (read-merge-write, no clobber)", () => {
      writeCredentialsFile(creds); // [default]
      process.env.TESTINGBOT_PROFILE = "team";
      writeCredentialsFile({
        client_key: "teamkey",
        client_secret: "teamsecret",
        user: { email: "team@example.com" },
      });

      const body = fs.readFileSync(credentialsPath(), "utf8");
      expect(body).toContain("[default]");
      expect(body).toContain("[team]");
      // The original [default] credentials survive the [team] write.
      expect(loadFromCredentialsFile("default")).toEqual({ key: "deadbeef", secret: "cafebabe" });
      expect(loadFromCredentialsFile("team")).toEqual({ key: "teamkey", secret: "teamsecret" });
    });

    it("preserves extra keys already stored under the active profile", () => {
      fs.mkdirSync(credentialsDir(), { recursive: true });
      fs.writeFileSync(
        credentialsPath(),
        ["[default]", "key = old", "secret = old", "region = eu", ""].join("\n")
      );

      writeCredentialsFile(creds);

      const body = fs.readFileSync(credentialsPath(), "utf8");
      expect(body).toContain("key = deadbeef");
      expect(body).toContain("secret = cafebabe");
      expect(body).toContain("region = eu"); // extra field survives the rewrite
    });

    it("tightens permissions to 0600 even when the file already exists world-readable", () => {
      fs.mkdirSync(credentialsDir(), { recursive: true });
      fs.writeFileSync(credentialsPath(), "[default]\nkey = x\nsecret = y\n", { mode: 0o644 });
      fs.chmodSync(credentialsPath(), 0o644);

      writeCredentialsFile(creds);

      expect(fs.statSync(credentialsPath()).mode & 0o777).toBe(0o600);
      // The atomic write leaves no stray temp file behind.
      expect(fs.existsSync(`${credentialsPath()}.tmp`)).toBe(false);
    });

  });

  // ---------------------------------------------------------------------------
  // Legacy ~/.testingbot key:secret FILE (testingbot-api, tunnel, older CLIs)
  // ---------------------------------------------------------------------------

  describe("legacy key:secret file", () => {
    const creds = {
      client_key: "deadbeef",
      client_secret: "cafebabe",
      user: { email: "ada@example.com", id: 7 },
    };
    let legacy: string;
    beforeEach(() => {
      // The config dir path is a FILE, as other TestingBot tools write it.
      legacy = path.join(tmpDir, "dotfile");
      process.env.TESTINGBOT_CONFIG_DIR = legacy;
      fs.writeFileSync(legacy, "legacykey:legacysecret\n", { mode: 0o644 });
    });

    it("reads it as the default profile", () => {
      expect(loadFromCredentialsFile()).toEqual({ key: "legacykey", secret: "legacysecret" });
      expect(loadFromCredentialsFile("team")).toBeNull();
    });

    it("ignores a file that is not key:secret", () => {
      fs.writeFileSync(legacy, "garbage\n");
      expect(loadFromCredentialsFile()).toBeNull();
    });

    it("tb_login updates it in place, keeps it a file, and backs up the old contents", () => {
      const written = writeCredentialsFile(creds);

      expect(written).toBe(legacy);
      expect(fs.statSync(legacy).isFile()).toBe(true); // never turned into a directory
      expect(fs.readFileSync(legacy, "utf8")).toBe("deadbeef:cafebabe\n");
      expect(fs.statSync(legacy).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(`${legacy}.bak`, "utf8")).toBe("legacykey:legacysecret\n");
      expect(fs.existsSync(`${legacy}.tmp`)).toBe(false);
      expect(loadFromCredentialsFile()).toEqual({ key: "deadbeef", secret: "cafebabe" });
    });

    it("writes no backup when the credentials are unchanged", () => {
      fs.writeFileSync(legacy, "deadbeef:cafebabe\n");
      writeCredentialsFile(creds);
      expect(fs.existsSync(`${legacy}.bak`)).toBe(false);
    });

    it("refuses a non-default profile and leaves the file untouched", () => {
      process.env.TESTINGBOT_PROFILE = "team";
      expect(() => writeCredentialsFile(creds)).toThrow(/TESTINGBOT_CONFIG_DIR/);
      expect(fs.readFileSync(legacy, "utf8")).toBe("legacykey:legacysecret\n");
    });
  });

  // ---------------------------------------------------------------------------
  // loadFromCredentialsFile edge cases
  // ---------------------------------------------------------------------------

  describe("loadFromCredentialsFile", () => {
    it("returns null when the file does not exist", () => {
      expect(loadFromCredentialsFile()).toBeNull();
    });

    it("returns null when the requested profile is absent", () => {
      writeCredentialsFile({
        client_key: "k",
        client_secret: "s",
        user: { email: "a@b.c" },
      });
      expect(loadFromCredentialsFile("nope")).toBeNull();
    });

    it("returns null when a profile is missing key or secret", () => {
      fs.writeFileSync(credentialsPath(), ["[default]", "key = onlykey"].join("\n"));
      expect(loadFromCredentialsFile()).toBeNull();
    });
  });
});
