import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

export default function addTeamTools(server: any, testingBotApi: any, _config: TestingBotConfig) {
  const tools: Record<string, any> = {};

  tools.getTeam = server.tool(
    "getTeam",
    "Retrieve team settings: plan details, team size, and concurrency (parallel sessions allowed, running now, and queued waiting for a free slot, for VMs and physical devices). Check this before starting many sessions in parallel.",
    {},
    async () => {
      try {
        logger.info("Fetching team settings");

        const response = await testingBotApi.getTeam();

        const team = response?.data || response;

        let formattedOutput = `## Team Settings\n\n`;

        if (team.name) {
          formattedOutput += `- **Team Name**: ${team.name}\n`;
        }
        if (team.plan) {
          formattedOutput += `- **Plan**: ${team.plan}\n`;
        }
        if (team.users !== undefined) {
          formattedOutput += `- **Users**: ${team.users}\n`;
        }
        if (team.parallel_tests !== undefined) {
          formattedOutput += `- **Parallel Tests**: ${team.parallel_tests}\n`;
        }
        if (team.max_parallel !== undefined) {
          formattedOutput += `- **Max Parallel**: ${team.max_parallel}\n`;
        }

        // Concurrency: plan caps, sessions running now and sessions waiting for a
        // free slot (GET /v1/team-management; counts are team-wide, from the Hub).
        if (team.concurrency) {
          formattedOutput += `\n### Concurrency\n`;
          const rows: Array<[string, { vms?: number; physical?: number } | undefined]> = [
            ["Allowed", team.concurrency.allowed],
            ["Running now", team.concurrency.current],
            ["Queued (waiting for a free slot)", team.concurrency.queued],
          ];
          for (const [label, counts] of rows) {
            if (!counts) {
              continue;
            }
            formattedOutput += `**${label}**:\n`;
            if (counts.vms !== undefined) {
              formattedOutput += `- VMs: ${counts.vms}\n`;
            }
            if (counts.physical !== undefined) {
              formattedOutput += `- Physical: ${counts.physical}\n`;
            }
          }
        }

        if (team.created_at) {
          formattedOutput += `\n- **Created**: ${team.created_at}\n`;
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
        return handleMCPError("getTeam", error);
      }
    }
  );

  tools.getUsersInTeam = server.tool(
    "getUsersInTeam",
    "List the members of the account's TestingBot team with each user's ID, email, plan, roles, read-only flag and concurrency limit. Read-only. Use it to find a `userId` for getUserFromTeam, or to see who has access. For plan and concurrency of the whole team use getTeam.",
    {},
    async () => {
      try {
        logger.info("Fetching team users");

        const response = await testingBotApi.getUsersInTeam();

        const users = response?.data || (Array.isArray(response) ? response : []);

        let formattedOutput = `## Team Users\n\n`;

        if (users.length > 0) {
          users.forEach((user: any) => {
            const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
            formattedOutput += `### ${fullName || `User ${user.id}`}\n`;
            formattedOutput += `- **User ID**: ${user.id}\n`;

            if (user.email) {
              formattedOutput += `- **Email**: ${user.email}\n`;
            }
            if (user.plan) {
              formattedOutput += `- **Plan**: ${user.plan}\n`;
            }
            if (user.roles && Array.isArray(user.roles) && user.roles.length > 0) {
              formattedOutput += `- **Roles**: ${user.roles.join(", ")}\n`;
            }
            if (user.read_only !== undefined) {
              formattedOutput += `- **Read Only**: ${user.read_only ? "Yes" : "No"}\n`;
            }
            if (user.max_concurrent !== undefined) {
              formattedOutput += `- **Max Concurrent**: ${user.max_concurrent}\n`;
            }
            if (user.max_concurrent_mobile !== undefined) {
              formattedOutput += `- **Max Concurrent Mobile**: ${user.max_concurrent_mobile}\n`;
            }
            if (user.seconds !== undefined) {
              formattedOutput += `- **Seconds**: ${user.seconds}\n`;
            }
            if (user.last_login) {
              formattedOutput += `- **Last Login**: ${user.last_login}\n`;
            }
            if (user.current_vm_concurrency !== undefined) {
              formattedOutput += `- **Current VM Concurrency**: ${user.current_vm_concurrency}\n`;
            }
            if (user.current_physical_concurrency !== undefined) {
              formattedOutput += `- **Current Physical Concurrency**: ${user.current_physical_concurrency}\n`;
            }
            formattedOutput += "\n";
          });
        } else {
          formattedOutput += "No users found in team.\n";
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
        return handleMCPError("getUsersInTeam", error);
      }
    }
  );

  tools.getUserFromTeam = server.tool(
    "getUserFromTeam",
    "Show one team member's details: name, email, role, whether the account is active, join date and last login. Read-only. Get `userId` from getUsersInTeam. For your own account use getUserInfo; for team-wide settings use getTeam. Returns an error if the user is not in your team.",
    {
      userId: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number())
        .describe("The user ID"),
    },
    async (args: { userId: number }) => {
      try {
        const userId = Number(args.userId);

        logger.info({ userId }, "Fetching team user details");

        const user = await testingBotApi.getUserFromTeam(userId);

        let formattedOutput = `## User Details: ${user.first_name || ""} ${user.last_name || ""}\n\n`;
        formattedOutput += `- **User ID**: ${user.id}\n`;
        formattedOutput += `- **Email**: ${user.email}\n`;

        if (user.first_name) {
          formattedOutput += `- **First Name**: ${user.first_name}\n`;
        }
        if (user.last_name) {
          formattedOutput += `- **Last Name**: ${user.last_name}\n`;
        }
        if (user.role) {
          formattedOutput += `- **Role**: ${user.role}\n`;
        }
        if (user.active !== undefined) {
          formattedOutput += `- **Active**: ${user.active ? "Yes" : "No"}\n`;
        }
        if (user.created_at) {
          formattedOutput += `- **Joined**: ${user.created_at}\n`;
        }
        if (user.last_login) {
          formattedOutput += `- **Last Login**: ${user.last_login}\n`;
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
        return handleMCPError("getUserFromTeam", error);
      }
    }
  );

  return tools;
}
