import logger from "./logger.js";

export function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9-_]/g, "");
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function handleMCPError(
  toolName: string,
  error: unknown
): {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
} {
  const errorMessage = formatError(error);
  logger.error({ tool: toolName, error: errorMessage }, "Tool execution failed");

  const readableToolName = toolName
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .trim();

  return {
    content: [
      {
        type: "text",
        text: `Failed to ${readableToolName}: ${errorMessage}. Please check your credentials and try again.`,
      },
    ],
    isError: true,
  };
}

export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
