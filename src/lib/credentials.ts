import { homedir } from "os";
import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  renameSync,
  statSync,
} from "fs";

// On-disk credential store for the TestingBot MCP server.
//
// Format: AWS-style INI with one profile per `[name]` block, living at
// `~/.testingbot/credentials` (mode 0600) inside a `~/.testingbot` directory
// (mode 0700). The `tb_login` device-auth tool writes it; `getConfig()` reads
// it when no environment variables are set. Set `TESTINGBOT_CONFIG_DIR` to
// relocate the directory (used by tests, and handy for sandboxed setups).
// If ~/.testingbot is instead a legacy `key:secret` file, that file is used as
// the default profile (see isLegacyCredentialFile below).
//
// We deliberately keep a tiny inline INI parser rather than add a dependency —
// the format is trivial and self-contained here.

export interface Credentials {
  key: string;
  secret: string;
}

export interface DeviceCredentials {
  client_key: string;
  client_secret: string;
  user: { email: string; id?: number };
}

const DEFAULT_PROFILE = "default";

export function credentialsDir(): string {
  return process.env.TESTINGBOT_CONFIG_DIR || join(homedir(), ".testingbot");
}

export function credentialsPath(): string {
  return join(credentialsDir(), "credentials");
}

export function activeProfile(): string {
  return process.env.TESTINGBOT_PROFILE || DEFAULT_PROFILE;
}

// Parse an INI document into { profile: { key: value } }. Tolerates comments
// (`#` / `;`), blank lines, and values containing `=`.
export function parseCredentialsIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let current: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      current = section[1].trim();
      out[current] = {};
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    out[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

// Load credentials from the credentials file for the active profile. Returns
// null when the file is missing, the profile is absent, or it lacks a complete
// key/secret pair — callers treat null as "no credentials".
export function loadFromCredentialsFile(profile: string = activeProfile()): Credentials | null {
  const dir = credentialsDir();
  if (isLegacyCredentialFile(dir)) {
    // A key:secret file holds one account: it is the default profile.
    return profile === DEFAULT_PROFILE ? readLegacyCredentialFile(dir) : null;
  }
  const path = credentialsPath();
  if (!existsSync(path)) return null;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const parsed = parseCredentialsIni(text);
  const p = parsed[profile];
  if (!p?.key || !p?.secret) return null;
  return { key: p.key, secret: p.secret };
}

// Other TestingBot tools (testingbot-api, the tunnel, older CLIs) keep
// credentials at ~/.testingbot as a single FILE in `key:secret` form. That path
// collides with our directory layout. We never move, rename or delete that file,
// since those tools still read it: we read it as the default profile, and
// tb_login updates it in place, in the same format.
function isLegacyCredentialFile(dir: string): boolean {
  try {
    return statSync(dir).isFile();
  } catch {
    return false;
  }
}

function readLegacyCredentialFile(dir: string): Credentials | null {
  let text: string;
  try {
    text = readFileSync(dir, "utf8");
  } catch {
    return null;
  }
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const key = line.slice(0, colon).trim();
  const secret = line.slice(colon + 1).trim();
  return key && secret ? { key, secret } : null;
}

// Update a legacy key:secret file in place (atomic, mode 0600). When this
// changes its contents, the previous contents are kept in `<file>.bak` first.
function writeLegacyCredentialFile(dir: string, creds: DeviceCredentials): string {
  if (activeProfile() !== DEFAULT_PROFILE) {
    throw new Error(
      `${dir} is a key:secret credentials file shared with other TestingBot tools, and holds ` +
        `only one account, so profile "${activeProfile()}" can't be saved there. Set ` +
        `TESTINGBOT_CONFIG_DIR to a separate directory for this profile. ${dir} was not changed.`
    );
  }
  const content = `${creds.client_key}:${creds.client_secret}\n`;
  const previous = readFileSync(dir, "utf8");
  if (previous.trim() === content.trim()) return dir;
  writeFileAtomic(`${dir}.bak`, previous);
  writeFileAtomic(dir, content);
  return dir;
}

// Write via a fresh temp file so mode 0600 applies at creation (writeFileSync's
// mode is ignored for an existing world-readable file), then rename over the
// target, so the secret is never briefly world-readable.
function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Best effort — chmod is a no-op / may be unsupported on some platforms.
  }
  renameSync(tmp, path);
}

function serializeCredentialsIni(
  profiles: Record<string, Record<string, string>>,
  accountEmail: string
): string {
  const lines = [
    `# Written by @testingbot/mcp-server tb_login at ${new Date().toISOString()}`,
    `# Account: ${accountEmail}`,
  ];
  for (const [name, kv] of Object.entries(profiles)) {
    lines.push(`[${name}]`);
    for (const [k, v] of Object.entries(kv)) lines.push(`${k} = ${v}`);
    lines.push("");
  }
  return lines.join("\n");
}

// Persist credentials returned by the device-auth flow into the active profile.
// Creates the directory (0700) and file (0600) with restrictive permissions —
// same UNIX convention as ~/.aws/credentials and ~/.ssh. Returns the file path.
//
// Other profiles already present in the file are preserved (read-merge-write):
// authenticating under TESTINGBOT_PROFILE=team must not wipe [default].
export function writeCredentialsFile(creds: DeviceCredentials): string {
  const dir = credentialsDir();
  if (isLegacyCredentialFile(dir)) return writeLegacyCredentialFile(dir, creds);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best effort — chmod is a no-op / may be unsupported on some platforms.
  }

  const path = credentialsPath();
  const profiles = existsSync(path) ? parseCredentialsIni(readFileSync(path, "utf8")) : {};
  // Merge into the active profile (preserve any extra keys it already held) and
  // leave all other profiles untouched.
  profiles[activeProfile()] = {
    ...profiles[activeProfile()],
    key: creds.client_key,
    secret: creds.client_secret,
  };

  writeFileAtomic(path, serializeCredentialsIni(profiles, creds.user.email));
  return path;
}
