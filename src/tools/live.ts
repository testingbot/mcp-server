import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError, validateUrl } from "../lib/utils.js";
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
};

// Mobile browser live session schema
const MobileLiveArgsShape = {
  platformType: z.literal(PlatformType.Mobile),
  desiredURL: z.string().url().describe("The URL to open in the mobile browser"),
  desiredOS: z.enum(["android", "ios"]).describe("Mobile platform (android or ios)"),
  desiredOSVersion: z.string().describe("OS version (e.g., '13.0', '16.0')"),
  desiredDevice: z.string().describe("Device name (e.g., 'iPhone 14', 'Galaxy S23')"),
};

type DesktopLiveArgs = z.infer<z.ZodObject<typeof DesktopLiveArgsShape>>;
type MobileLiveArgs = z.infer<z.ZodObject<typeof MobileLiveArgsShape>>;
type LiveArgs = DesktopLiveArgs | MobileLiveArgs;

/**
 * Construct environment ID for TestingBot based on browser/device configuration
 */
function constructEnvironmentId(args: LiveArgs): string {
  if (args.platformType === PlatformType.Desktop) {
    const desktopArgs = args as DesktopLiveArgs;
    const os = desktopArgs.desiredOS.toLowerCase();
    const osVersion = desktopArgs.desiredOSVersion;
    const browser = desktopArgs.desiredBrowser.toLowerCase();
    const browserVersion = desktopArgs.desiredBrowserVersion || "latest";

    // Format: browser_version_os_osVersion
    // Example: chrome_120_windows_11
    return `${browser}_${browserVersion}_${os}_${osVersion.replace(/\s+/g, "_")}`;
  } else {
    const mobileArgs = args as MobileLiveArgs;
    const platform = mobileArgs.desiredOS.toLowerCase();
    const platformVersion = mobileArgs.desiredOSVersion;
    const device = mobileArgs.desiredDevice.replace(/\s+/g, "_");

    // Format: platform_platformVersion_device
    // Example: ios_16.0_iPhone_14
    return `${platform}_${platformVersion}_${device}`;
  }
}

async function startLiveSession(args: LiveArgs, _config: TestingBotConfig): Promise<string> {
  const url = args.desiredURL;

  if (!validateUrl(url)) {
    throw new Error("Invalid URL provided");
  }

  const environmentId = constructEnvironmentId(args);
  const sessionUrl = `https://testingbot.com/members/manual/start?browser=${environmentId}&url=${encodeURIComponent(url)}`;

  logger.info(
    {
      platformType: args.platformType,
      environmentId,
      url,
    },
    "Starting live session"
  );

  return sessionUrl;
}

export default function addLiveTools(server: any, testingBotApi: any, config: TestingBotConfig) {
  const tools: Record<string, any> = {};

  tools.startLiveSession = server.tool(
    "startLiveSession",
    "Start an interactive live testing session on TestingBot. Opens a real browser or mobile device for manual testing. Supports both desktop browsers (Chrome, Firefox, Safari, Edge, IE) and mobile devices (iOS, Android).",
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

        const sessionUrl = await startLiveSession(validatedArgs, config);

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
        } else {
          const mobileArgs = validatedArgs as MobileLiveArgs;
          formattedOutput += `**Configuration:**\n`;
          formattedOutput += `- Platform: Mobile\n`;
          formattedOutput += `- Device: ${mobileArgs.desiredDevice}\n`;
          formattedOutput += `- OS: ${mobileArgs.desiredOS} ${mobileArgs.desiredOSVersion}\n`;
          formattedOutput += `- URL: ${mobileArgs.desiredURL}\n\n`;
        }

        formattedOutput += `**Instructions:**\n`;
        formattedOutput += `1. Click the URL above or copy it to your browser\n`;
        formattedOutput += `2. Log in to TestingBot if prompted\n`;
        formattedOutput += `3. The live session will start automatically\n`;
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
    "Convenience tool to start a desktop browser live testing session. Automatically sets platformType to 'desktop'.",
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
    },
    async (args: Omit<DesktopLiveArgs, "platformType">) => {
      try {
        const fullArgs: DesktopLiveArgs = {
          ...args,
          platformType: PlatformType.Desktop,
        };

        const sessionUrl = await startLiveSession(fullArgs, config);

        let formattedOutput = "## Desktop Live Session Ready\n\n";
        formattedOutput += `**Session URL**: ${sessionUrl}\n\n`;
        formattedOutput += `**Configuration:**\n`;
        formattedOutput += `- Browser: ${args.desiredBrowser} ${args.desiredBrowserVersion || "latest"}\n`;
        formattedOutput += `- OS: ${args.desiredOS} ${args.desiredOSVersion}\n`;
        formattedOutput += `- URL: ${args.desiredURL}\n\n`;
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
    "Convenience tool to start a mobile device live testing session. Automatically sets platformType to 'mobile'.",
    {
      desiredURL: z.string().url().describe("The URL to open in the mobile browser"),
      desiredOS: z.enum(["android", "ios"]).describe("Mobile platform (android or ios)"),
      desiredOSVersion: z.string().describe("OS version (e.g., '13.0', '16.0')"),
      desiredDevice: z.string().describe("Device name (e.g., 'iPhone 14', 'Galaxy S23')"),
    },
    async (args: Omit<MobileLiveArgs, "platformType">) => {
      try {
        const fullArgs: MobileLiveArgs = {
          ...args,
          platformType: PlatformType.Mobile,
        };

        const sessionUrl = await startLiveSession(fullArgs, config);

        let formattedOutput = "## Mobile Live Session Ready\n\n";
        formattedOutput += `**Session URL**: ${sessionUrl}\n\n`;
        formattedOutput += `**Configuration:**\n`;
        formattedOutput += `- Device: ${args.desiredDevice}\n`;
        formattedOutput += `- OS: ${args.desiredOS} ${args.desiredOSVersion}\n`;
        formattedOutput += `- URL: ${args.desiredURL}\n\n`;
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
