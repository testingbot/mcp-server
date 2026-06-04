import { z } from "zod";
import path from "path";
import fs from "fs";
import { TestingBotConfig } from "../lib/types.js";
import { handleMCPError } from "../lib/utils.js";
import logger from "../lib/logger.js";

// =============================================================================
// Framework detection
// =============================================================================

type Framework =
  | "playwright"
  | "cypress"
  | "webdriverio"
  | "selenium-js"
  | "nightwatch"
  | "puppeteer"
  | "jest"
  | "mocha"
  | "vitest"
  | "unknown";

type Language = "javascript" | "typescript" | "python" | "java" | "ruby" | "unknown";

interface DetectionResult {
  projectRoot: string;
  language: Language;
  framework: Framework;
  testFileGlobs: string[];
  testDirs: string[];
  packageManager: "npm" | "yarn" | "pnpm" | null;
  detectedFrom: string;
}

const FRAMEWORK_PACKAGE_HINTS: Array<{ pkg: string; framework: Framework }> = [
  { pkg: "@playwright/test", framework: "playwright" },
  { pkg: "playwright", framework: "playwright" },
  { pkg: "cypress", framework: "cypress" },
  { pkg: "webdriverio", framework: "webdriverio" },
  { pkg: "@wdio/cli", framework: "webdriverio" },
  { pkg: "nightwatch", framework: "nightwatch" },
  { pkg: "selenium-webdriver", framework: "selenium-js" },
  { pkg: "puppeteer", framework: "puppeteer" },
  { pkg: "vitest", framework: "vitest" },
  { pkg: "jest", framework: "jest" },
  { pkg: "mocha", framework: "mocha" },
];

const FRAMEWORK_DEFAULTS: Record<Framework, { globs: string[]; dirs: string[] }> = {
  playwright: {
    globs: ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js"],
    dirs: ["tests", "e2e", "playwright"],
  },
  cypress: { globs: ["**/*.cy.ts", "**/*.cy.js"], dirs: ["cypress/e2e", "cypress/integration"] },
  webdriverio: {
    globs: ["**/*.e2e.ts", "**/*.e2e.js", "**/*.spec.ts", "**/*.spec.js"],
    dirs: ["test", "tests", "e2e"],
  },
  "selenium-js": {
    globs: ["**/*.test.js", "**/*.test.ts", "**/*.spec.js", "**/*.spec.ts"],
    dirs: ["test", "tests"],
  },
  nightwatch: { globs: ["**/*.js", "**/*.ts"], dirs: ["tests", "nightwatch/e2e"] },
  puppeteer: { globs: ["**/*.test.js", "**/*.test.ts"], dirs: ["test", "tests"] },
  jest: {
    globs: ["**/*.test.ts", "**/*.test.js", "**/*.spec.ts", "**/*.spec.js"],
    dirs: ["__tests__", "test", "tests"],
  },
  mocha: { globs: ["**/*.test.js", "**/*.spec.js"], dirs: ["test"] },
  vitest: { globs: ["**/*.test.ts", "**/*.test.js"], dirs: ["test", "tests"] },
  unknown: { globs: ["**/*.test.*", "**/*.spec.*"], dirs: ["test", "tests"] },
};

function safeReadJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function detectPackageManager(projectRoot: string): DetectionResult["packageManager"] {
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(projectRoot, "package-lock.json"))) return "npm";
  return null;
}

function detectFromPython(projectRoot: string): Partial<DetectionResult> | null {
  if (
    !fs.existsSync(path.join(projectRoot, "requirements.txt")) &&
    !fs.existsSync(path.join(projectRoot, "pyproject.toml")) &&
    !fs.existsSync(path.join(projectRoot, "Pipfile"))
  ) {
    return null;
  }
  // Cheap content match — agents will use the result as a hint, not gospel.
  let content = "";
  for (const f of ["requirements.txt", "pyproject.toml", "Pipfile"]) {
    const p = path.join(projectRoot, f);
    if (fs.existsSync(p)) content += fs.readFileSync(p, "utf8") + "\n";
  }
  let framework: Framework = "unknown";
  if (/playwright/i.test(content)) framework = "playwright";
  else if (/selenium/i.test(content)) framework = "selenium-js";
  return {
    language: "python",
    framework,
    testFileGlobs: ["**/test_*.py", "**/*_test.py"],
    testDirs: ["tests", "test"],
    detectedFrom: "requirements.txt / pyproject.toml",
  };
}

function detectFromJava(projectRoot: string): Partial<DetectionResult> | null {
  const pom = path.join(projectRoot, "pom.xml");
  const gradle = path.join(projectRoot, "build.gradle");
  const gradleKts = path.join(projectRoot, "build.gradle.kts");
  let buildFile: string | null = null;
  if (fs.existsSync(pom)) buildFile = pom;
  else if (fs.existsSync(gradle)) buildFile = gradle;
  else if (fs.existsSync(gradleKts)) buildFile = gradleKts;
  if (!buildFile) return null;

  const content = fs.readFileSync(buildFile, "utf8");
  let framework: Framework = "unknown";
  if (/selenium/i.test(content)) framework = "selenium-js";
  else if (/playwright/i.test(content)) framework = "playwright";

  return {
    language: "java",
    framework,
    testFileGlobs: ["**/*Test.java", "**/*IT.java", "**/Test*.java"],
    testDirs: ["src/test/java"],
    detectedFrom: path.basename(buildFile),
  };
}

function detectFromRuby(projectRoot: string): Partial<DetectionResult> | null {
  const gemfile = path.join(projectRoot, "Gemfile");
  if (!fs.existsSync(gemfile)) return null;
  const content = fs.readFileSync(gemfile, "utf8");
  let framework: Framework = "unknown";
  if (/selenium-webdriver/i.test(content)) framework = "selenium-js";
  return {
    language: "ruby",
    framework,
    testFileGlobs: ["**/*_spec.rb", "**/*_test.rb"],
    testDirs: ["spec", "test"],
    detectedFrom: "Gemfile",
  };
}

function detectFromNode(projectRoot: string): Partial<DetectionResult> | null {
  const pkg = safeReadJson(path.join(projectRoot, "package.json"));
  if (!pkg) return null;

  const deps: Record<string, unknown> = {
    ...((pkg.dependencies as Record<string, unknown>) || {}),
    ...((pkg.devDependencies as Record<string, unknown>) || {}),
  };

  let framework: Framework = "unknown";
  for (const hint of FRAMEWORK_PACKAGE_HINTS) {
    if (deps[hint.pkg]) {
      framework = hint.framework;
      break;
    }
  }

  const isTs = !!deps["typescript"] || fs.existsSync(path.join(projectRoot, "tsconfig.json"));
  const defaults = FRAMEWORK_DEFAULTS[framework];

  return {
    language: isTs ? "typescript" : "javascript",
    framework,
    testFileGlobs: defaults.globs,
    testDirs: defaults.dirs,
    detectedFrom: "package.json",
  };
}

export function detectFramework(projectRoot: string): DetectionResult {
  const resolved = path.resolve(projectRoot);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Project root does not exist or is not a directory: ${resolved}`);
  }

  const node = detectFromNode(resolved);
  const python = !node ? detectFromPython(resolved) : null;
  const java = !node && !python ? detectFromJava(resolved) : null;
  const ruby = !node && !python && !java ? detectFromRuby(resolved) : null;
  const detected = node || python || java || ruby;

  if (!detected) {
    return {
      projectRoot: resolved,
      language: "unknown",
      framework: "unknown",
      testFileGlobs: FRAMEWORK_DEFAULTS.unknown.globs,
      testDirs: FRAMEWORK_DEFAULTS.unknown.dirs,
      packageManager: detectPackageManager(resolved),
      detectedFrom: "no manifest found",
    };
  }

  return {
    projectRoot: resolved,
    language: detected.language!,
    framework: detected.framework!,
    testFileGlobs: detected.testFileGlobs!,
    testDirs: detected.testDirs!,
    packageManager: detectPackageManager(resolved),
    detectedFrom: detected.detectedFrom!,
  };
}

// =============================================================================
// listTestFiles — walk the detected test dirs
// =============================================================================

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
]);

function* walk(dir: string, maxDepth: number, depth = 0): Generator<string> {
  if (depth > maxDepth) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..") continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, maxDepth, depth + 1);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function matchesAnyGlob(file: string, globs: string[]): boolean {
  // Translate a minimal glob subset (`**`, `*`, `?`, `.`) into a RegExp.
  return globs.some((g) => {
    const re = new RegExp(
      "^" +
        g
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, "::DOUBLESTAR::")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, ".")
          .replace(/::DOUBLESTAR::/g, ".*") +
        "$"
    );
    return re.test(file.replace(/\\/g, "/"));
  });
}

// =============================================================================
// SDK config snippets
// =============================================================================

function configSnippet(framework: Framework, language: Language): string {
  if (framework === "playwright") {
    return [
      "```typescript",
      "// playwright.config.ts — TestingBot connection",
      "import { defineConfig } from '@playwright/test';",
      "",
      "const wsEndpoint = `wss://cloud.testingbot.com/playwright?` + new URLSearchParams({",
      "  key: process.env.TESTINGBOT_KEY!,",
      "  secret: process.env.TESTINGBOT_SECRET!,",
      "  browserName: 'chrome',",
      "  browserVersion: 'latest',",
      "  os: 'WIN11',",
      "}).toString();",
      "",
      "export default defineConfig({",
      "  use: { connectOptions: { wsEndpoint } },",
      "});",
      "```",
    ].join("\n");
  }
  if (framework === "selenium-js") {
    return [
      "```" + (language === "typescript" ? "typescript" : "javascript"),
      "// selenium-webdriver — TestingBot remote driver",
      "const { Builder } = require('selenium-webdriver');",
      "",
      "const driver = await new Builder()",
      "  .usingServer(`https://${process.env.TESTINGBOT_KEY}:${process.env.TESTINGBOT_SECRET}@hub.testingbot.com/wd/hub`)",
      "  .withCapabilities({",
      "    browserName: 'chrome',",
      "    browserVersion: 'latest',",
      "    platformName: 'Windows 11',",
      "    'tb:options': { name: 'My Test', build: 'build-1' },",
      "  })",
      "  .build();",
      "```",
    ].join("\n");
  }
  if (framework === "webdriverio") {
    return [
      "```javascript",
      "// wdio.conf.js — TestingBot service",
      "exports.config = {",
      "  user: process.env.TESTINGBOT_KEY,",
      "  key: process.env.TESTINGBOT_SECRET,",
      "  hostname: 'hub.testingbot.com',",
      "  port: 443,",
      "  path: '/wd/hub',",
      "  protocol: 'https',",
      "  services: ['testingbot'],",
      "  capabilities: [{ browserName: 'chrome', browserVersion: 'latest', platformName: 'Windows 11' }],",
      "};",
      "```",
    ].join("\n");
  }
  if (framework === "cypress") {
    return [
      "Cypress runs on TestingBot via the [Cypress add-on](https://testingbot.com/support/cypress).",
      "After running `npm install -g testingbot-cypress-cli`, kick off a run with:",
      "```bash",
      "testingbot-cypress run \\\\",
      "  --key $TESTINGBOT_KEY \\\\",
      "  --secret $TESTINGBOT_SECRET \\\\",
      "  --browser chrome",
      "```",
    ].join("\n");
  }
  if (framework === "puppeteer") {
    return [
      "```javascript",
      "// Puppeteer — connect to TestingBot",
      "const puppeteer = require('puppeteer-core');",
      "const browser = await puppeteer.connect({",
      "  browserWSEndpoint: `wss://cloud.testingbot.com/puppeteer?key=${process.env.TESTINGBOT_KEY}&secret=${process.env.TESTINGBOT_SECRET}&browserName=chrome&browserVersion=latest`,",
      "});",
      "```",
    ].join("\n");
  }
  if (framework === "nightwatch") {
    return [
      "```javascript",
      "// nightwatch.conf.js — TestingBot environment",
      "module.exports = {",
      "  test_settings: {",
      "    testingbot: {",
      "      selenium: { host: 'hub.testingbot.com', port: 443 },",
      "      username: process.env.TESTINGBOT_KEY,",
      "      access_key: process.env.TESTINGBOT_SECRET,",
      "      desiredCapabilities: { browserName: 'chrome', browserVersion: 'latest', platformName: 'Windows 11' },",
      "    },",
      "  },",
      "};",
      "```",
    ].join("\n");
  }
  return [
    "No first-class TestingBot integration auto-detected.",
    "General pattern: point your driver at `https://hub.testingbot.com/wd/hub` (Selenium),",
    "or use the wss endpoints at `wss://cloud.testingbot.com/{playwright,puppeteer}` for browser-protocol clients.",
    "See https://testingbot.com/support for framework-specific guides.",
  ].join("\n");
}

function installCommand(
  framework: Framework,
  packageManager: DetectionResult["packageManager"]
): string | null {
  const pm = packageManager || "npm";
  const installCmd =
    pm === "yarn" ? "yarn add --dev" : pm === "pnpm" ? "pnpm add -D" : "npm install --save-dev";
  if (framework === "webdriverio") return `${installCmd} @wdio/testingbot-service`;
  if (framework === "cypress") return `npm install -g testingbot-cypress-cli`;
  return null;
}

// =============================================================================
// Tool registration
// =============================================================================

export default function addProjectTools(
  server: any,
  _testingBotApi: any,
  _config: TestingBotConfig
) {
  const tools: Record<string, any> = {};

  tools.listTestFiles = server.tool(
    "listTestFiles",
    "Scan a project directory and return test files for the detected framework. Read-only — never modifies files.",
    {
      projectRoot: z.string().min(1).describe("Absolute path to the project root to scan."),
      maxDepth: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().min(1).max(15))
        .optional()
        .default(8)
        .describe("Max directory depth to walk (default 8)."),
      maxResults: z
        .union([z.number(), z.string().transform(Number)])
        .pipe(z.number().int().min(1).max(2000))
        .optional()
        .default(200)
        .describe("Cap on returned file paths (default 200, max 2000)."),
    },
    async (args: { projectRoot: string; maxDepth?: number; maxResults?: number }) => {
      try {
        const detection = detectFramework(args.projectRoot);
        const maxDepth = args.maxDepth ?? 8;
        const maxResults = args.maxResults ?? 200;

        logger.info(
          { projectRoot: detection.projectRoot, framework: detection.framework },
          "Scanning project for test files"
        );

        const found = new Set<string>();
        const searchRoots = detection.testDirs
          .map((d) => path.join(detection.projectRoot, d))
          .filter((d) => fs.existsSync(d));
        const roots = searchRoots.length > 0 ? searchRoots : [detection.projectRoot];

        outer: for (const root of roots) {
          for (const file of walk(root, maxDepth)) {
            const rel = path.relative(detection.projectRoot, file);
            if (matchesAnyGlob(rel, detection.testFileGlobs)) {
              found.add(rel);
              if (found.size >= maxResults) break outer;
            }
          }
        }

        const fileList = [...found].sort();

        let output = `## Test Files in ${detection.projectRoot}\n\n`;
        output += `- **Language**: ${detection.language}\n`;
        output += `- **Framework**: ${detection.framework} (detected from ${detection.detectedFrom})\n`;
        output += `- **Package manager**: ${detection.packageManager ?? "n/a"}\n`;
        output += `- **Search roots**: ${roots.map((r) => path.relative(detection.projectRoot, r) || ".").join(", ")}\n`;
        output += `- **Globs**: ${detection.testFileGlobs.join(", ")}\n`;
        output += `- **Matched**: ${fileList.length}${fileList.length >= maxResults ? " (cap reached)" : ""}\n\n`;

        if (fileList.length === 0) {
          output +=
            "_No matching test files found. Try a different `projectRoot` or pass explicit `maxDepth`._\n";
        } else {
          output += fileList.map((f) => `- ${f}`).join("\n") + "\n";
        }

        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return handleMCPError("listTestFiles", error);
      }
    }
  );

  tools.setupTestingBot = server.tool(
    "setupTestingBot",
    "Detect the testing framework in a project and return the ready-to-paste TestingBot configuration snippet, install command, and env-var requirements. Read-only — never modifies files; the agent or user applies the snippet.",
    {
      projectRoot: z.string().min(1).describe("Absolute path to the project root to inspect."),
      frameworkOverride: z
        .enum(["playwright", "cypress", "webdriverio", "selenium-js", "nightwatch", "puppeteer"])
        .optional()
        .describe("Force a specific framework instead of using auto-detection."),
    },
    async (args: { projectRoot: string; frameworkOverride?: Framework }) => {
      try {
        const detection = detectFramework(args.projectRoot);
        const framework: Framework = args.frameworkOverride ?? detection.framework;

        logger.info(
          { projectRoot: detection.projectRoot, framework, override: !!args.frameworkOverride },
          "Generating SDK setup instructions"
        );

        const snippet = configSnippet(framework, detection.language);
        const install = installCommand(framework, detection.packageManager);

        let output = `## TestingBot SDK Setup\n\n`;
        output += `- **Project**: ${detection.projectRoot}\n`;
        output += `- **Language**: ${detection.language}\n`;
        output += `- **Framework**: ${framework}${args.frameworkOverride ? " (overridden)" : ` (detected from ${detection.detectedFrom})`}\n`;
        output += `- **Package manager**: ${detection.packageManager ?? "n/a"}\n\n`;

        output += `### 1. Set credentials\n\nExport these in your shell or CI environment:\n\n`;
        output += "```bash\nexport TESTINGBOT_KEY=...\nexport TESTINGBOT_SECRET=...\n```\n\n";
        output += "Get them at https://testingbot.com/members/user/security\n\n";

        if (install) {
          output += `### 2. Install dependency\n\n\`\`\`bash\n${install}\n\`\`\`\n\n### 3. Configure\n\n`;
        } else {
          output += `### 2. Configure\n\n`;
        }
        output += snippet + "\n\n";

        output += `### Next steps\n\n`;
        output += `- Run your existing test command — it will execute against TestingBot.\n`;
        output += `- Use \`getTests\` / \`getTestDetails\` / \`getFailureLogs\` to inspect results.\n`;

        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return handleMCPError("setupTestingBot", error);
      }
    }
  );

  return tools;
}
