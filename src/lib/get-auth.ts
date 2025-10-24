import { TestingBotConfig } from "./types.js";

export function getAuth(config: TestingBotConfig): { username: string; password: string } {
  return {
    username: config["testingbot-key"],
    password: config["testingbot-secret"],
  };
}
