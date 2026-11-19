import { describe, it, expect } from "vitest";
import { TestingBotMcpServer } from "../src/server-factory.js";
import { TOOL_ANNOTATIONS } from "../src/lib/tool-annotations.js";

// Glama's Tool Definition Quality Score (and MCP clients deciding when to ask
// before running a tool) rely on annotations and on descriptions that say what
// a tool changes. Keep both from regressing as tools are added.

describe("tool annotations", () => {
  const server = new TestingBotMcpServer({}, {
    "testingbot-key": "k",
    "testingbot-secret": "s",
  } as any);
  const tools = server.listTools();

  it.each(tools.map((tool) => [tool.name, tool] as const))(
    "%s is annotated",
    (_name, tool: any) => {
      expect(tool.annotations).toBeDefined();
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        expect(typeof tool.annotations[hint], hint).toBe("boolean");
      }
      expect(tool.annotations.title).toBeTruthy();
      // A read-only tool can't be destructive.
      if (tool.annotations.readOnlyHint) expect(tool.annotations.destructiveHint).toBe(false);
    }
  );

  it("has no annotations for tools that no longer exist", () => {
    const names = new Set(tools.map((tool) => tool.name));
    expect(Object.keys(TOOL_ANNOTATIONS).filter((name) => !names.has(name))).toEqual([]);
  });

  it.each(
    tools
      .filter((tool: any) => tool.annotations?.destructiveHint)
      .map((tool) => [tool.name, tool] as const)
  )("%s says in its description what it destroys", (_name, tool) => {
    expect(tool.description).toMatch(
      /permanent|cannot be undone|replac|end(s|ing)? |stop|shut down|cancel/i
    );
  });

  it.each(tools.map((tool) => [tool.name, tool] as const))(
    "%s has a description that goes beyond the schema",
    (_name, tool) => {
      expect(tool.description.length).toBeGreaterThan(120);
    }
  );
});
