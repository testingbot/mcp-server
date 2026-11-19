import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { getPrompt, listPrompts, PROMPTS } from "../src/prompts.js";
import { readResource, RESOURCE_TEMPLATES, STATIC_RESOURCES } from "../src/resources.js";

describe("prompts", () => {
  it("lists the three task prompts with their arguments", () => {
    const names = listPrompts().map((p) => p.name);
    expect(names).toEqual(["why-did-my-test-fail", "summarise-build", "find-flaky-tests"]);
    expect(listPrompts()[0].arguments[0]).toMatchObject({ name: "sessionId", required: true });
  });

  it("builds a user message that names the tools to use", () => {
    const result = getPrompt("why-did-my-test-fail", { sessionId: "abc123" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    const text = result.messages[0].content.text;
    expect(text).toContain("getTestDetails for abc123");
    expect(text).toContain("getFailureLogs");
    expect(text).toContain("testingbot://tests/abc123");
  });

  it("defaults the flaky-test window", () => {
    const text = getPrompt("find-flaky-tests").messages[0].content.text;
    expect(text).toContain("last 30d");
    expect(text).toContain("testingbot://insights/flaky-tests?time_range=30d");
  });

  it("rejects a missing required argument and an unknown prompt", () => {
    expect(() => getPrompt("summarise-build", {})).toThrow(/buildId/);
    expect(() => getPrompt("nope")).toThrow(/Unknown prompt/);
  });

  it("has a skill file for every prompt", () => {
    for (const prompt of PROMPTS) {
      const file = path.join(__dirname, "..", "skills", prompt.name, "SKILL.md");
      const body = fs.readFileSync(file, "utf8");
      expect(body).toMatch(new RegExp(`^---\\nname: ${prompt.name}\\ndescription: .+\\n---`));
    }
  });
});

describe("resources", () => {
  let api: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    api = { getTestDetails: vi.fn(), getTestsForBuild: vi.fn(), request: vi.fn() };
  });

  it("publishes templates and the flaky-tests resource", () => {
    expect(RESOURCE_TEMPLATES.map((t) => t.uriTemplate)).toContain("testingbot://tests/{sessionId}");
    expect(STATIC_RESOURCES[0].uri).toBe("testingbot://insights/flaky-tests");
  });

  it("reads a test without its rendered steps", async () => {
    api.getTestDetails.mockResolvedValue({ session_id: "abc123", success: false });
    const result = await readResource(api, "testingbot://tests/abc123");

    expect(api.getTestDetails).toHaveBeenCalledWith("abc123", { skip_fields: "steps" });
    expect(JSON.parse(result.contents[0].text)).toMatchObject({ session_id: "abc123" });
    expect(result.contents[0].mimeType).toBe("application/json");
  });

  it("reads the tail of a log", async () => {
    api.getTestDetails.mockResolvedValue({ logs: { selenium: "https://logs.example/s.log" } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("line1\nERROR boom\n", { status: 200 })
    );
    const result = await readResource(api, "testingbot://tests/abc123/logs/selenium");

    expect(result.contents[0].text).toContain("ERROR boom");
    expect(result.contents[0].mimeType).toBe("text/plain");
  });

  it("refuses unknown log types", async () => {
    await expect(readResource(api, "testingbot://tests/abc/logs/secrets")).rejects.toThrow(
      /Unknown log type/
    );
  });

  it("reads a build", async () => {
    api.getTestsForBuild.mockResolvedValue({ data: [{ id: 1 }] });
    await readResource(api, "testingbot://builds/4711");
    expect(api.getTestsForBuild).toHaveBeenCalledWith("4711");
  });

  it("reads flaky tests from the insights API, keeping only flaky rows", async () => {
    api.request.mockResolvedValue({
      data: [
        { name: "a", flaky: true, pass_rate: 0.8 },
        { name: "b", flaky: false, pass_rate: 1 },
      ],
      meta: { total: 2 },
    });
    const result = await readResource(api, "testingbot://insights/flaky-tests?time_range=7d");

    expect(api.request).toHaveBeenCalledWith({
      method: "GET",
      url: "/insights/test-cases",
      data: { sort: "flaky", sort_order: "desc", time_range: "7d", count: 50 },
    });
    expect(JSON.parse(result.contents[0].text).flaky_tests).toHaveLength(1);
  });

  it("rejects a bad time range and unknown URIs", async () => {
    await expect(
      readResource(api, "testingbot://insights/flaky-tests?time_range=forever")
    ).rejects.toThrow(/time_range/);
    await expect(readResource(api, "testingbot://nope/1")).rejects.toThrow(/Unknown resource/);
    await expect(readResource(api, "https://example.com/")).rejects.toThrow(/Unknown resource/);
  });
});
