// MCP prompts (prompts/list, prompts/get): ready-made task recipes a client can
// offer as slash commands. Each one returns a single user message that tells the
// model which TestingBot tools and resources to use, in which order, and what to
// report. They only reference tools by name; nothing is called here.

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
  build: (args: Record<string, string>) => string;
}

function arg(args: Record<string, string>, name: string, fallback = ""): string {
  const value = args[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export const PROMPTS: PromptDefinition[] = [
  {
    name: "why-did-my-test-fail",
    title: "Why did my test fail?",
    description:
      "Investigate one failed TestingBot test: status, AI failure analysis when enabled, and the failing log lines.",
    arguments: [
      {
        name: "sessionId",
        description: "Session ID (or numeric test ID) of the failed test.",
        required: true,
      },
    ],
    build: (args) => {
      const id = arg(args, "sessionId");
      return [
        `Find out why TestingBot test ${id} failed.`,
        "",
        `1. Call getTestDetails for ${id} (or read the resource testingbot://tests/${id}) to get its status, status message, environment and which logs exist.`,
        `2. If the analyzeTestFailure tool is available, call it for ${id}. If it reports that AI Analysis is not enabled, do not ask to enable it; carry on with the logs.`,
        `3. Call getFailureLogs for ${id} with failuresOnly=true. Read the full log of one type only if the failing lines are not enough.`,
        "4. Report: what the test was doing, the step that failed, the most likely cause (application bug, test script, environment or flaky), the log lines that show it, and one to three concrete fixes. Quote the evidence; say how sure you are and do not guess beyond it.",
      ].join("\n");
    },
  },
  {
    name: "summarise-build",
    title: "Summarise a build",
    description:
      "Summarise a TestingBot build: pass/fail counts, the failures grouped by cause, and what to fix first.",
    arguments: [
      {
        name: "buildId",
        description: "ID of the build (from getBuilds).",
        required: true,
      },
    ],
    build: (args) => {
      const id = arg(args, "buildId");
      return [
        `Summarise TestingBot build ${id}.`,
        "",
        `1. Call getTestsForBuild for build ${id} (or read testingbot://builds/${id}).`,
        "2. Count passed, failed and unknown tests, and list the environments (browser/OS or device) they ran on.",
        "3. For each failed test (at most 10), call getFailureLogs with failuresOnly=true. If analyzeTestFailure is available and enabled, use getAiFailureAnalysis to read existing analyses first; only start new ones for up to 3 tests.",
        "4. Group the failures by shared cause (same error message, same environment, same step).",
        "5. Report a short summary line, a table of failure groups with the affected tests and environments, and what to fix first. Mention tests that failed in one environment only.",
      ].join("\n");
    },
  },
  {
    name: "find-flaky-tests",
    title: "Find flaky tests",
    description:
      "Find tests that both passed and failed recently and suggest why they are unstable.",
    arguments: [
      {
        name: "timeRange",
        description: "How far back to look, e.g. 7d or 30d (default 30d).",
        required: false,
      },
    ],
    build: (args) => {
      const range = arg(args, "timeRange", "30d");
      return [
        `Find flaky TestingBot tests over the last ${range}.`,
        "",
        `1. Read the resource testingbot://insights/flaky-tests?time_range=${encodeURIComponent(range)}. It lists test names with their pass rate and a flaky flag, most flaky first.`,
        "2. For the top 5 flaky tests, call getTests and pick one recent failed and one recent passed run of each; call getFailureLogs with failuresOnly=true on the failed run.",
        "3. Look for timing problems (timeouts, waits, animations), order dependence, shared test data, or one environment failing more than others.",
        "4. Report a ranked list: test name, pass rate, runs, the likely reason it is unstable, and a concrete change to make it stable.",
      ].join("\n");
    },
  },
];

export function listPrompts() {
  return PROMPTS.map(({ name, title, description, arguments: args }) => ({
    name,
    title,
    description,
    arguments: args,
  }));
}

export function getPrompt(name: string, args: Record<string, string> = {}) {
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) throw new Error(`Unknown prompt: ${name}`);
  for (const a of prompt.arguments) {
    if (a.required && !arg(args, a.name)) {
      throw new Error(`Prompt ${name} needs the argument "${a.name}"`);
    }
  }
  return {
    description: prompt.description,
    messages: [
      { role: "user" as const, content: { type: "text" as const, text: prompt.build(args) } },
    ],
  };
}
