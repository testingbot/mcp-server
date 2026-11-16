import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Converts a tool's Zod shape (`{ arg: z.string(), ... }`) to the JSON Schema
// object MCP expects as `inputSchema`. Inline everything ($refStrategy none):
// MCP clients do not resolve $ref, and a reused sub-schema would otherwise be
// emitted as a reference to a definition that is not part of the payload.
export function toolInputSchema(shape: Record<string, any> | undefined): any {
  const converted: any = zodToJsonSchema(z.object(shape ?? {}), {
    target: "jsonSchema7",
    $refStrategy: "none",
  });
  delete converted.$schema;
  return converted;
}
