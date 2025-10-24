import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

export default function addTunnelTools(server: any, testingBotApi: any, _config: TestingBotConfig) {
  const tools: Record<string, any> = {};

  tools.getTunnelList = server.tool(
    "getTunnelList",
    "Get a list of all active TestingBot tunnels. Tunnels allow you to test websites behind firewalls or on your local machine.",
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

            if (tunnel.status) {
              formattedOutput += `- **Status**: ${tunnel.status}\n`;
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
          formattedOutput += "To start a tunnel, download and run the TestingBot Tunnel:\n";
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

  return tools;
}
