import { z } from "zod";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

export default function addUserTools(server: any, testingBotApi: any, _config: TestingBotConfig) {
  const tools: Record<string, any> = {};

  tools.getUserInfo = server.tool(
    "getUserInfo",
    "Get current user account information including minutes used, plan details, and account status.",
    {},
    async () => {
      try {
        logger.info("Fetching user info");

        const userInfo = await testingBotApi.getUserInfo();

        let formattedOutput = "## User Information\n\n";
        formattedOutput += `- **Name**: ${userInfo.first_name} ${userInfo.last_name}\n`;
        formattedOutput += `- **Email**: ${userInfo.email}\n`;

        if (userInfo.minutes_used !== undefined) {
          formattedOutput += `- **Minutes Used**: ${userInfo.minutes_used}\n`;
        }
        if (userInfo.minutes_limit !== undefined) {
          formattedOutput += `- **Minutes Limit**: ${userInfo.minutes_limit}\n`;
        }
        if (userInfo.plan !== undefined) {
          formattedOutput += `- **Plan**: ${userInfo.plan}\n`;
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
        return handleMCPError("getUserInfo", error);
      }
    }
  );

  tools.updateUserInfo = server.tool(
    "updateUserInfo",
    "Update user account information such as name, email, or other profile details.",
    {
      firstName: z.string().optional().describe("First name"),
      lastName: z.string().optional().describe("Last name"),
      email: z.string().email().optional().describe("Email address"),
    },
    async (args: { firstName?: string; lastName?: string; email?: string }) => {
      try {
        logger.info({ updates: args }, "Updating user info");

        const updateData: any = {};
        if (args.firstName) updateData.first_name = args.firstName;
        if (args.lastName) updateData.last_name = args.lastName;
        if (args.email) updateData.email = args.email;

        await testingBotApi.updateUserInfo(updateData);

        return {
          content: [
            {
              type: "text",
              text: "User information updated successfully.",
            },
          ],
        };
      } catch (error) {
        return handleMCPError("updateUserInfo", error);
      }
    }
  );

  return tools;
}
