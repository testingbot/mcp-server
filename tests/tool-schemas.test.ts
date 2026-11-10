import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { z } from "zod";
import { TestingBotMcpServer, toolInputSchema } from "../src/server-factory.js";

// TB-967: tools/list used to publish each tool's Zod objects as
// `inputSchema.properties`, so 54 of 90 tools exposed `_def` / `~standard`
// instead of JSON Schema and MCP clients could not validate or prompt for
// their arguments.

const findZodInternals = (node: any, path = "$"): string[] => {
  if (node === null || typeof node !== "object") return [];
  const hits: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "_def" || key === "~standard" || key === "_cached") hits.push(`${path}.${key}`);
    hits.push(...findZodInternals(value, `${path}.${key}`));
  }
  return hits;
};

describe("tools/list input schemas", () => {
  const server = new TestingBotMcpServer({}, {
    "testingbot-key": "k",
    "testingbot-secret": "s",
  } as any);
  const tools = server.listTools();
  // strict: false so vendor keywords zod-to-json-schema never emits anyway are
  // not the point; compile() still throws on a structurally invalid schema.
  const ajv = new Ajv({ strict: false });

  it("registers the local tools", () => {
    expect(tools.length).toBeGreaterThan(40);
  });

  it.each(tools.map((tool) => [tool.name, tool] as const))(
    "%s has a valid JSON Schema",
    (_name, tool) => {
      const schema = JSON.parse(JSON.stringify(tool.inputSchema));
      expect(findZodInternals(schema)).toEqual([]);
      expect(schema.type).toBe("object");
      expect(typeof schema.properties).toBe("object");
      expect(() => ajv.compile(schema)).not.toThrow();
      for (const key of schema.required ?? []) {
        expect(schema.properties).toHaveProperty(key);
      }
    }
  );

  it("keeps descriptions, enums and optionality", () => {
    const schema = toolInputSchema({
      type: z.enum(["web", "mobile"]).optional().describe("Filter browsers by type"),
      id: z.string().describe("Session id"),
    });
    expect(schema.properties.type).toMatchObject({
      type: "string",
      enum: ["web", "mobile"],
      description: "Filter browsers by type",
    });
    expect(schema.required).toEqual(["id"]);
  });

  it("passes a proxied tool's raw JSON Schema through unchanged", () => {
    const raw = { type: "object", properties: { x: { type: "number" } }, required: ["x"] };
    server.tools.proxied = {
      name: "proxied",
      description: "d",
      schema: {},
      inputSchema: raw,
      handler: async () => ({}),
    };
    const listed = server.listTools().find((tool) => tool.name === "proxied");
    expect(listed?.inputSchema).toBe(raw);
    delete server.tools.proxied;
  });
});
