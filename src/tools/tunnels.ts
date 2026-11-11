import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";
import { tunnelManager, TunnelManager } from "../lib/tunnel-manager.js";

// How to point each kind of run at a tunnel. TestingBot only routes WebDriver
// sessions through a tunnel that the session names; other run types pick it up
// as listed.
function usageText(identifier: string, tunnelId?: number | string): string {
  let out = `**Use it:**\n`;
  out += `- \`tb_openBrowser\`: pass \`tunnelIdentifier: "${identifier}"\` — required, sessions without it do not use the tunnel\n`;
  out += `- \`runMaestroTest\`: pass \`tunnelIdentifier: "${identifier}"\`\n`;
  if (tunnelId !== undefined) {
    out += `- \`startLiveSession\`: pass \`tunnelId: ${tunnelId}\`\n`;
  }
  out += `- Screenshots, Espresso and XCUITest runs use the account's newest running tunnel automatically\n`;
  return out;
}

export default function addTunnelTools(
  server: any,
  testingBotApi: any,
  config: TestingBotConfig,
  manager: TunnelManager = tunnelManager
) {
  const tools: Record<string, any> = {};

  tools.getTunnelList = server.tool(
    "getTunnelList",
    "Get a list of all active TestingBot tunnels on the account, with their identifiers. Tunnels allow you to test websites behind firewalls or on your local machine.",
    {},
    async () => {
      try {
        logger.info("Fetching tunnel list");

        const tunnels = await testingBotApi.getTunnelList();

        let formattedOutput = `## Active Tunnels\n\n`;

        if (Array.isArray(tunnels) && tunnels.length > 0) {
          tunnels.forEach((tunnel: any) => {
            formattedOutput += `### Tunnel ${tunnel.id}\n`;
            formattedOutput += `- **ID**: ${tunnel.id}\n`;

            if (tunnel.identifier) {
              formattedOutput += `- **Identifier**: \`${tunnel.identifier}\`${manager.get(tunnel.identifier) ? " (started by this MCP server)" : ""}\n`;
            }
            const status = tunnel.status ?? tunnel.state;
            if (status) {
              formattedOutput += `- **Status**: ${status}\n`;
            }
            if (tunnel.version) {
              formattedOutput += `- **Version**: ${tunnel.version}\n`;
            }
            if (tunnel.created_at) {
              formattedOutput += `- **Created**: ${tunnel.created_at}\n`;
            }
            if (tunnel.ip) {
              formattedOutput += `- **IP Address**: ${tunnel.ip}\n`;
            }
            if (tunnel.last_heartbeat) {
              formattedOutput += `- **Last Heartbeat**: ${tunnel.last_heartbeat}\n`;
            }

            formattedOutput += "\n";
          });

          formattedOutput += `\n**Total**: ${tunnels.length} active tunnel${tunnels.length === 1 ? "" : "s"}\n`;
        } else {
          formattedOutput += "No active tunnels found.\n\n";
          formattedOutput +=
            "Use `startTunnel` to start one from this MCP server, or download and run the TestingBot Tunnel yourself:\n";
          formattedOutput += "https://testingbot.com/support/other/tunnel\n";
        }

        return {
          content: [
            {
              type: "text",
              text: formattedOutput,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("getTunnelList", error);
      }
    }
  );

  tools.deleteTunnel = server.tool(
    "deleteTunnel",
    "Delete an active TestingBot tunnel by its ID. This will terminate the tunnel connection.",
    {
      tunnelId: z.union([z.number(), z.string()]).describe("The tunnel ID to delete"),
    },
    async (args: { tunnelId: number | string }) => {
      try {
        const tunnelId = args.tunnelId;

        logger.info({ tunnelId }, "Deleting tunnel");

        await testingBotApi.deleteTunnel(tunnelId);

        return {
          content: [
            {
              type: "text",
              text: `Tunnel ${tunnelId} deleted successfully.`,
            },
          ],
        };
      } catch (error) {
        return handleMCPError("deleteTunnel", error);
      }
    }
  );

  tools.startTunnel = server.tool(
    "startTunnel",
    "Start a TestingBot Tunnel on this machine so remote browsers and devices can reach localhost, private-network and intranet URLs. Call this BEFORE testing any local or private URL. Waits until the tunnel is ready (can take up to a minute on first use, which downloads the tunnel) and returns its identifier — pass that as `tunnelIdentifier` to tb_openBrowser / runMaestroTest. Requires Java 17+ on this machine. The tunnel keeps running until stopTunnel is called or the MCP server exits.",
    {
      tunnelIdentifier: z
        .string()
        .regex(/^[A-Za-z0-9._-]{1,64}$/, "Use letters, digits, '.', '_' or '-' (max 64)")
        .optional()
        .describe(
          "Identifier for the tunnel. Optional — a unique one is generated. Starting again with an identifier this server already runs returns the running tunnel."
        ),
      shared: z
        .boolean()
        .optional()
        .describe("Share the tunnel with the other members of the TestingBot team"),
      noBump: z
        .boolean()
        .optional()
        .describe(
          "Do not re-sign HTTPS traffic in the tunnel. Use when the site uses certificate pinning or client certificates."
        ),
      noCache: z.boolean().optional().describe("Disable the tunnel's caching of static assets"),
    },
    async (args: {
      tunnelIdentifier?: string;
      shared?: boolean;
      noBump?: boolean;
      noCache?: boolean;
    }) => {
      try {
        const { tunnel, reused } = await manager.start({
          apiKey: config["testingbot-key"],
          apiSecret: config["testingbot-secret"],
          tunnelIdentifier: args.tunnelIdentifier,
          shared: args.shared,
          noBump: args.noBump,
          noCache: args.noCache,
        });

        // The numeric ID is what live sessions take; look it up best-effort.
        let tunnelId: number | string | undefined;
        try {
          const list = await testingBotApi.getTunnelList();
          if (Array.isArray(list)) {
            tunnelId = list.find((t: any) => t?.identifier === tunnel.identifier)?.id;
          }
        } catch (error) {
          logger.warn({ error }, "Could not look up the tunnel ID");
        }

        let text = reused ? `## Tunnel already running\n\n` : `## Tunnel started\n\n`;
        text += `- **Identifier**: \`${tunnel.identifier}\`\n`;
        if (tunnelId !== undefined) text += `- **Tunnel ID**: ${tunnelId}\n`;
        text += `- **Started**: ${tunnel.startedAt.toISOString()}\n\n`;
        text += usageText(tunnel.identifier, tunnelId);
        text += `\nCall \`stopTunnel\` when done.`;

        return { content: [{ type: "text", text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const hint = /java/i.test(message)
          ? " TestingBot Tunnel needs Java 17 or newer on the machine running this MCP server (https://adoptium.net)."
          : "";
        return handleMCPError("startTunnel", new Error(`${message}${hint}`));
      }
    }
  );

  tools.stopTunnel = server.tool(
    "stopTunnel",
    "Stop a TestingBot Tunnel that was started with startTunnel. Without a tunnelIdentifier, stops the only one running (or all of them with all: true). For tunnels started outside this MCP server, use deleteTunnel.",
    {
      tunnelIdentifier: z.string().optional().describe("Identifier returned by startTunnel"),
      all: z.boolean().optional().describe("Stop every tunnel this MCP server started"),
    },
    async (args: { tunnelIdentifier?: string; all?: boolean }) => {
      try {
        const running = manager.list();

        let targets: string[];
        if (args.tunnelIdentifier) {
          targets = [args.tunnelIdentifier];
        } else if (args.all || running.length === 1) {
          targets = running.map((t) => t.identifier);
        } else if (running.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "This MCP server is not running any tunnels. Use getTunnelList and deleteTunnel for tunnels started elsewhere.",
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Several tunnels are running: ${running.map((t) => `\`${t.identifier}\``).join(", ")}. Pass tunnelIdentifier, or all: true.`,
              },
            ],
            isError: true,
          };
        }

        const lines: string[] = [];
        for (const id of targets) {
          const stopped = await manager.stop(id);
          lines.push(
            stopped
              ? `Tunnel \`${id}\` stopped.`
              : `No tunnel \`${id}\` was started by this MCP server. Use getTunnelList and deleteTunnel for tunnels started elsewhere.`
          );
        }
        if (lines.length === 0) lines.push("No tunnels to stop.");

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return handleMCPError("stopTunnel", error);
      }
    }
  );

  return tools;
}
