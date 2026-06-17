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

        // The /v1/user endpoint returns first_name/last_name, plan, company,
        // country, seconds, and concurrency limits. It does NOT return an email
        // field. Guard every line so absent fields are omitted rather than
        // rendered as "undefined".
        const name = [userInfo.first_name, userInfo.last_name].filter(Boolean).join(" ");

        let formattedOutput = "## User Information\n\n";
        if (name) {
          formattedOutput += `- **Name**: ${name}\n`;
        }
        if (userInfo.email) {
          formattedOutput += `- **Email**: ${userInfo.email}\n`;
        }
        if (userInfo.company) {
          formattedOutput += `- **Company**: ${userInfo.company}\n`;
        }
        if (userInfo.country) {
          formattedOutput += `- **Country**: ${userInfo.country}\n`;
        }
        if (userInfo.plan !== undefined) {
          formattedOutput += `- **Plan**: ${userInfo.plan}\n`;
        }
        if (userInfo.seconds !== undefined) {
          formattedOutput += `- **Seconds Available**: ${userInfo.seconds}\n`;
        }
        if (userInfo.max_concurrent !== undefined) {
          formattedOutput += `- **Max Concurrency**: ${userInfo.max_concurrent}\n`;
        }
        if (userInfo.max_concurrent_mobile !== undefined) {
          formattedOutput += `- **Max Mobile Concurrency**: ${userInfo.max_concurrent_mobile}\n`;
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
