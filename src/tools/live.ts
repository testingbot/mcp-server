import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError, isPrivateUrl, PRIVATE_URL_HINT, validateUrl } from "../lib/utils.js";
import logger from "../lib/logger.js";

enum PlatformType {
  Desktop = "desktop",
  Mobile = "mobile",
}

const DesktopLiveArgsShape = {
  platformType: z.literal(PlatformType.Desktop),
  desiredURL: z.string().url().describe("The URL to open in the browser"),
  desiredOS: z
    .enum(["Windows", "Mac", "Linux"])
    .describe("Operating system (Windows, Mac, or Linux)"),
  desiredOSVersion: z.string().describe("OS version (e.g., '11', '13', 'Monterey')"),
  desiredBrowser: z.enum(["chrome", "firefox", "safari", "edge", "ie"]).describe("Browser name"),
  desiredBrowserVersion: z
    .string()
    .optional()
    .describe("Browser version or 'latest' (default: latest)"),
  tunnelId: z
    .union([z.number(), z.string().transform(Number)])
    .pipe(z.number().int().positive())
    .optional()
    .describe(
      "Numeric ID of a running TestingBot Tunnel (from startTunnel or getTunnelList) to route the session through. Needed for localhost / private-network URLs."
    ),
};

// Mobile browser live session schema
const MobileLiveArgsShape = {
  platformType: z.literal(PlatformType.Mobile),
  desiredURL: z.string().url().describe("The URL to open in the mobile browser"),
  desiredOS: z.enum(["android", "ios"]).describe("Mobile platform (android or ios)"),
  desiredOSVersion: z.string().describe("OS version (e.g., '13.0', '16.0')"),
  desiredDevice: z.string().describe("Device name (e.g., 'iPhone 14', 'Galaxy S23')"),
  tunnelId: z
    .union([z.number(), z.string().transform(Number)])
    .pipe(z.number().int().positive())
    .optional()
    .describe(
      "Numeric ID of a running TestingBot Tunnel (from startTunnel or getTunnelList) to route the session through. Needed for localhost / private-network URLs."
    ),
};

type DesktopLiveArgs = z.infer<z.ZodObject<typeof DesktopLiveArgsShape>>;
type MobileLiveArgs = z.infer<z.ZodObject<typeof MobileLiveArgsShape>>;
type LiveArgs = DesktopLiveArgs | MobileLiveArgs;

const LIVE_START_URL = "https://testingbot.com/members/manual/start";

// Browser names as the TestingBot catalog / capability resolver knows them.
// "chrome" is resolved server-side to both chrome and googlechrome.
const BROWSER_NAMES: Record<string, string> = {
  chrome: "chrome",
  firefox: "firefox",
  safari: "safari",
  edge: "microsoftedge",
  ie: "iexplore",
};

// macOS: marketing names and major versions → TestingBot platform codes.
const MAC_PLATFORMS: Record<string, string> = {
  tahoe: "TAHOE",
  "26": "TAHOE",
  sequoia: "SEQUOIA",
  "15": "SEQUOIA",
  sonoma: "SONOMA",
  "14": "SONOMA",
  ventura: "VENTURA",
  "13": "VENTURA",
  monterey: "MONTEREY",
  "12": "MONTEREY",
  bigsur: "BIGSUR",
  "11": "BIGSUR",
  catalina: "CATALINA",
  "10.15": "CATALINA",
  mojave: "MOJAVE",
  "10.14": "MOJAVE",
  highsierra: "HIGH-SIERRA",
  "10.13": "HIGH-SIERRA",
};

const WINDOWS_PLATFORMS: Record<string, string> = {
  "11": "WIN11",
  "10": "WIN10",
  "8.1": "WIN8_1",
  "8": "WIN8",
  vista: "VISTA",
};

const KNOWN_PLATFORM_CODES = new Set([
  ...Object.values(MAC_PLATFORMS),
  ...Object.values(WINDOWS_PLATFORMS),
  "LINUX",
]);

/**
 * Map an OS + version as a user says it ("Windows" "11", "Mac" "Sonoma",
 * "Mac" "14") to the TestingBot platform code the live launcher expects.
 */
export function desktopPlatformCode(os: string, osVersion: string): string {
  const version = osVersion.trim();
  // Already a platform code, e.g. "WIN11" or "SONOMA".
  if (KNOWN_PLATFORM_CODES.has(version.toUpperCase())) return version.toUpperCase();

  const key = version
    .toLowerCase()
    .replace(/^(macos|mac os x|mac os|os x|windows|win)\s*/, "")
    .replace(/[\s_-]+/g, "");
  const family = os.toLowerCase();

  if (family === "linux") return "LINUX";
  if (family === "windows") {
    const code = WINDOWS_PLATFORMS[key];
    if (code) return code;
    throw new Error(
      `Unknown Windows version "${osVersion}". Use one of: 11, 10, 8.1, 8 (or a platform code such as WIN11).`
    );
  }
  if (family === "mac") {
    const code = MAC_PLATFORMS[key] ?? MAC_PLATFORMS[key.split(".")[0]];
    if (code) return code;
    throw new Error(
      `Unknown macOS version "${osVersion}". Use a name (Tahoe, Sequoia, Sonoma, Ventura, Monterey, Big Sur, Catalina, Mojave, High Sierra), a version number, or a platform code such as SONOMA.`
    );
  }
  throw new Error(`Unknown desktop OS "${os}". Use Windows, Mac or Linux.`);
}

interface CatalogEntry {
  name?: string;
  platform?: string;
  platformName?: string;
  deviceName?: string;
  version?: string;
  browser_id?: number;
}

function compareVersions(a = "", b = ""): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Find the emulator/simulator in TestingBot's browser catalog for a mobile live
 * session. The live launcher only takes its numeric browser_id.
 */
async function resolveMobileBrowserId(testingBotApi: any, args: MobileLiveArgs): Promise<number> {
  const catalog: CatalogEntry[] = await testingBotApi.getBrowsers();
  const os = args.desiredOS.toLowerCase();
  const wantedDevice = args.desiredDevice.trim().toLowerCase();
  const wantedVersion = args.desiredOSVersion.trim();

  const candidates = (Array.isArray(catalog) ? catalog : []).filter(
    (b) =>
      b.deviceName &&
      b.browser_id &&
      (b.platformName ?? "").toLowerCase() === os &&
      // Real devices are not opened through this link.
      !(b.platform ?? "").startsWith("REAL_")
  );

  const versionMatches = (v = "") =>
    v === wantedVersion ||
    v.startsWith(`${wantedVersion}.`) ||
    // "16.0" asked, "16" listed (or the reverse)
    compareVersions(v, wantedVersion) === 0;

  const byName = (exact: boolean) =>
    candidates.filter((b) => {
      const name = (b.deviceName as string).toLowerCase();
      return exact ? name === wantedDevice : name.includes(wantedDevice);
    });

  // Prefer the platform's own browser: Chrome on Android, Safari on iOS.
  const preferred = os === "android" ? "chrome" : "safari";
  const pick = (list: CatalogEntry[]) =>
    list
      .filter((b) => versionMatches(b.version))
      .sort(
        (a, b) =>
          Number(b.name === preferred) - Number(a.name === preferred) ||
          compareVersions(b.version, a.version)
      )[0];

  const match = pick(byName(true)) ?? pick(byName(false));
  if (match?.browser_id) return match.browser_id;

  const sameDevice = byName(false);
  const hint = sameDevice.length
    ? `Available versions for "${args.desiredDevice}": ${[...new Set(sameDevice.map((b) => b.version))].sort(compareVersions).join(", ")}.`
    : `Use getBrowsers with type "mobile" to see the available ${args.desiredOS === "ios" ? "iOS simulators" : "Android emulators"}.`;
  throw new Error(
    `No ${args.desiredOS} emulator/simulator matches "${args.desiredDevice}" on version ${args.desiredOSVersion}. ${hint} (Live sessions on real devices are started from the TestingBot dashboard.)`
  );
}

/**
 * Build the live-session launch link. It opens a confirm page in the user's
 * signed-in TestingBot dashboard; the session starts when they press Start.
 * The launcher takes either a numeric browser id or browserName + version +
 * platform (resolved the same way as Selenium capabilities).
 */
async function buildLiveSessionUrl(args: LiveArgs, testingBotApi: any): Promise<string> {
  if (!validateUrl(args.desiredURL)) {
    throw new Error("Invalid URL provided");
  }

  const params = new URLSearchParams({ url: args.desiredURL });

  if (args.platformType === PlatformType.Desktop) {
    const desktopArgs = args as DesktopLiveArgs;
    params.set(
      "browserName",
      BROWSER_NAMES[desktopArgs.desiredBrowser.toLowerCase()] ?? desktopArgs.desiredBrowser
    );
    params.set("version", desktopArgs.desiredBrowserVersion || "latest");
    params.set(
      "platform",
      desktopPlatformCode(desktopArgs.desiredOS, desktopArgs.desiredOSVersion)
    );
  } else {
    params.set(
      "browser",
      String(await resolveMobileBrowserId(testingBotApi, args as MobileLiveArgs))
    );
  }

  // The launch page preselects this tunnel; the session then runs through it.
  if (args.tunnelId) params.set("tunnel", String(args.tunnelId));

  const sessionUrl = `${LIVE_START_URL}?${params.toString()}`;
  logger.info({ platformType: args.platformType, sessionUrl }, "Starting live session");
  return sessionUrl;
}

// Tunnel line for the session summary, plus a warning when a local URL is opened
// without one (it would fail to load in the cloud browser).
function tunnelNote(url: string, tunnelId?: number): string {
  if (tunnelId) return `- Tunnel: ${tunnelId}\n\n`;
  if (isPrivateUrl(url)) {
    return `> ⚠️ ${PRIVATE_URL_HINT} Then pass its numeric ID as \`tunnelId\`.\n\n`;
  }
  return "";
}

export default function addLiveTools(server: any, testingBotApi: any, _config: TestingBotConfig) {
  const tools: Record<string, any> = {};

  tools.startLiveSession = server.tool(
    "startLiveSession",
    "Start an interactive live testing session on TestingBot. Returns a link that opens the session in the user's TestingBot dashboard (they confirm with Start). Supports desktop browsers (Chrome, Firefox, Safari, Edge, IE) and mobile emulators/simulators (Android, iOS). For localhost / private-network URLs, start a tunnel first (startTunnel) and pass its numeric ID as tunnelId.",
    {
      platformType: z
        .enum([PlatformType.Desktop, PlatformType.Mobile])
        .describe("Platform type: 'desktop' for desktop browsers or 'mobile' for mobile devices"),
      desiredURL: z.string().url().describe("The URL to open in the browser"),
      desiredOS: z
        .string()
        .describe(
          "Operating system: 'Windows', 'Mac', 'Linux' for desktop; 'android', 'ios' for mobile"
        ),
      desiredOSVersion: z
        .string()
        .describe("OS version (e.g., '11' for Windows 11, '16.0' for iOS 16)"),
      desiredBrowser: z
        .string()
        .optional()
        .describe("Browser name for desktop: 'chrome', 'firefox', 'safari', 'edge', 'ie'"),
      desiredBrowserVersion: z
        .string()
        .optional()
        .describe("Browser version or 'latest' (default: latest)"),
      desiredDevice: z
        .string()
        .optional()
        .describe("Device name for mobile (e.g., 'iPhone 14', 'Galaxy S23')"),
      tunnelId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .optional()
        .describe(
          "Numeric ID of a running TestingBot Tunnel (from startTunnel or getTunnelList) to route the session through. Needed for localhost / private-network URLs."
        ),
    },
    async (args: any) => {
      try {
        // Validate and parse args based on platform type
        let validatedArgs: LiveArgs;

        if (args.platformType === PlatformType.Desktop) {
          const desktopSchema = z.object(DesktopLiveArgsShape);
          validatedArgs = desktopSchema.parse(args);
        } else if (args.platformType === PlatformType.Mobile) {
          const mobileSchema = z.object(MobileLiveArgsShape);
          validatedArgs = mobileSchema.parse(args);
        } else {
          throw new Error("Invalid platformType. Must be 'desktop' or 'mobile'");
        }

        const sessionUrl = await buildLiveSessionUrl(validatedArgs, testingBotApi);

        let formattedOutput = "## Live Session Ready\n\n";
        formattedOutput += `Your interactive testing session is ready to start!\n\n`;
        formattedOutput += `**Session URL**: ${sessionUrl}\n\n`;

        if (validatedArgs.platformType === PlatformType.Desktop) {
          const desktopArgs = validatedArgs as DesktopLiveArgs;
          formattedOutput += `**Configuration:**\n`;
          formattedOutput += `- Platform: Desktop\n`;
          formattedOutput += `- Browser: ${desktopArgs.desiredBrowser} ${desktopArgs.desiredBrowserVersion || "latest"}\n`;
          formattedOutput += `- OS: ${desktopArgs.desiredOS} ${desktopArgs.desiredOSVersion}\n`;
          formattedOutput += `- URL: ${desktopArgs.desiredURL}\n\n`;
          formattedOutput += tunnelNote(desktopArgs.desiredURL, desktopArgs.tunnelId);
        } else {
          const mobileArgs = validatedArgs as MobileLiveArgs;
          formattedOutput += `**Configuration:**\n`;
          formattedOutput += `- Platform: Mobile\n`;
          formattedOutput += `- Device: ${mobileArgs.desiredDevice}\n`;
          formattedOutput += `- OS: ${mobileArgs.desiredOS} ${mobileArgs.desiredOSVersion}\n`;
          formattedOutput += `- URL: ${mobileArgs.desiredURL}\n\n`;
          formattedOutput += tunnelNote(mobileArgs.desiredURL, mobileArgs.tunnelId);
        }

        formattedOutput += `**Instructions:**\n`;
        formattedOutput += `1. Click the URL above or copy it to your browser\n`;
        formattedOutput += `2. Log in to TestingBot if prompted\n`;
        formattedOutput += `3. Check the browser/device shown and press Start\n`;
        formattedOutput += `4. Interact with the browser/device in real-time\n`;

        return {
          content: [
            {
              type: "text",
              text: formattedOutput,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("startLiveSession", error);
      }
    }
  );

  tools.startDesktopLiveSession = server.tool(
    "startDesktopLiveSession",
    "Convenience tool to start a desktop browser live testing session. Automatically sets platformType to 'desktop'. For localhost / private-network URLs, pass the tunnelId of a running tunnel (startTunnel).",
    {
      desiredURL: z.string().url().describe("The URL to open in the browser"),
      desiredOS: z
        .enum(["Windows", "Mac", "Linux"])
        .describe("Operating system (Windows, Mac, or Linux)"),
      desiredOSVersion: z.string().describe("OS version (e.g., '11', '13', 'Monterey')"),
      desiredBrowser: z
        .enum(["chrome", "firefox", "safari", "edge", "ie"])
        .describe("Browser name"),
      desiredBrowserVersion: z
        .string()
        .optional()
        .default("latest")
        .describe("Browser version or 'latest' (default: latest)"),
      tunnelId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .optional()
        .describe(
          "Numeric ID of a running TestingBot Tunnel (from startTunnel or getTunnelList) to route the session through. Needed for localhost / private-network URLs."
        ),
    },
    async (args: Omit<DesktopLiveArgs, "platformType">) => {
      try {
        const fullArgs: DesktopLiveArgs = {
          ...args,
          platformType: PlatformType.Desktop,
        };

        const sessionUrl = await buildLiveSessionUrl(fullArgs, testingBotApi);

        let formattedOutput = "## Desktop Live Session Ready\n\n";
        formattedOutput += `**Session URL**: ${sessionUrl}\n\n`;
        formattedOutput += `**Configuration:**\n`;
        formattedOutput += `- Browser: ${args.desiredBrowser} ${args.desiredBrowserVersion || "latest"}\n`;
        formattedOutput += `- OS: ${args.desiredOS} ${args.desiredOSVersion}\n`;
        formattedOutput += `- URL: ${args.desiredURL}\n\n`;
        formattedOutput += tunnelNote(args.desiredURL, args.tunnelId);
        formattedOutput += `Click the URL above to start your interactive testing session.`;

        return {
          content: [
            {
              type: "text",
              text: formattedOutput,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("startDesktopLiveSession", error);
      }
    }
  );

  tools.startMobileLiveSession = server.tool(
    "startMobileLiveSession",
    "Convenience tool to start a live testing session on a mobile emulator/simulator. Automatically sets platformType to 'mobile'. For localhost / private-network URLs, pass the tunnelId of a running tunnel (startTunnel).",
    {
      desiredURL: z.string().url().describe("The URL to open in the mobile browser"),
      desiredOS: z.enum(["android", "ios"]).describe("Mobile platform (android or ios)"),
      desiredOSVersion: z.string().describe("OS version (e.g., '13.0', '16.0')"),
      desiredDevice: z.string().describe("Device name (e.g., 'iPhone 14', 'Galaxy S23')"),
      tunnelId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().positive())
        .optional()
        .describe(
          "Numeric ID of a running TestingBot Tunnel (from startTunnel or getTunnelList) to route the session through. Needed for localhost / private-network URLs."
        ),
    },
    async (args: Omit<MobileLiveArgs, "platformType">) => {
      try {
        const fullArgs: MobileLiveArgs = {
          ...args,
          platformType: PlatformType.Mobile,
        };

        const sessionUrl = await buildLiveSessionUrl(fullArgs, testingBotApi);

        let formattedOutput = "## Mobile Live Session Ready\n\n";
        formattedOutput += `**Session URL**: ${sessionUrl}\n\n`;
        formattedOutput += `**Configuration:**\n`;
        formattedOutput += `- Device: ${args.desiredDevice}\n`;
        formattedOutput += `- OS: ${args.desiredOS} ${args.desiredOSVersion}\n`;
        formattedOutput += `- URL: ${args.desiredURL}\n\n`;
        formattedOutput += tunnelNote(args.desiredURL, args.tunnelId);
        formattedOutput += `Click the URL above to start your interactive mobile testing session.`;

        return {
          content: [
            {
              type: "text",
              text: formattedOutput,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("startMobileLiveSession", error);
      }
    }
  );

  return tools;
}
