import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

export default function addTeamTools(server: any, testingBotApi: any, _config: TestingBotConfig) {
  const tools: Record<string, any> = {};

  tools.getTeam = server.tool(
    "getTeam",
    "Retrieve team settings and information including plan details, team size, and configuration.",
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

        // Concurrency information
        if (team.concurrency) {
          formattedOutput += `\n### Concurrency\n`;
          if (team.concurrency.allowed) {
            formattedOutput += `**Allowed**:\n`;
            if (team.concurrency.allowed.vms !== undefined) {
              formattedOutput += `- VMs: ${team.concurrency.allowed.vms}\n`;
            }
            if (team.concurrency.allowed.physical !== undefined) {
              formattedOutput += `- Physical: ${team.concurrency.allowed.physical}\n`;
            }
          }
          if (team.concurrency.current) {
            formattedOutput += `**Current**:\n`;
            if (team.concurrency.current.vms !== undefined) {
              formattedOutput += `- VMs: ${team.concurrency.current.vms}\n`;
            }
            if (team.concurrency.current.physical !== undefined) {
              formattedOutput += `- Physical: ${team.concurrency.current.physical}\n`;
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
    "Get a list of all users in your team with their roles and permissions.",
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
    "Retrieve detailed information about a specific user in your team by their user ID.",
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
