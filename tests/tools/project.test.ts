import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import addProjectTools from "../../src/tools/project.js";

describe("Project Tools", () => {
  let serverMock: any;
  let testingBotApiMock: any;
  let configMock: any;
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => ({ name, desc, schema, handler })),
    };
    testingBotApiMock = {};
    configMock = { "testingbot-key": "k", "testingbot-secret": "s" };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-mcp-project-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(rel: string, content = "") {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  // ---------------------------------------------------------------------------
  // listTestFiles
  // ---------------------------------------------------------------------------

  describe("listTestFiles", () => {
    it("detects a Playwright project and finds *.spec.ts files", async () => {
      writeFile(
        "package.json",
        JSON.stringify({ devDependencies: { "@playwright/test": "^1.40.0", typescript: "^5" } })
      );
      writeFile("tsconfig.json", "{}");
      writeFile("tests/login.spec.ts", "// test");
      writeFile("tests/checkout.spec.ts", "// test");
      writeFile("src/app.ts", "// not a test");

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.listTestFiles.handler({ projectRoot: tmpDir });

      expect(result.content[0].text).toContain("**Framework**: playwright");
      expect(result.content[0].text).toContain("**Language**: typescript");
      expect(result.content[0].text).toContain("tests/login.spec.ts");
      expect(result.content[0].text).toContain("tests/checkout.spec.ts");
      expect(result.content[0].text).not.toContain("src/app.ts");
    });

    it("detects a Cypress project and finds *.cy.js files", async () => {
      writeFile("package.json", JSON.stringify({ devDependencies: { cypress: "^13" } }));
      writeFile("cypress/e2e/login.cy.js", "");
      writeFile("cypress/e2e/checkout.cy.js", "");

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.listTestFiles.handler({ projectRoot: tmpDir });

      expect(result.content[0].text).toContain("**Framework**: cypress");
      expect(result.content[0].text).toContain("cypress/e2e/login.cy.js");
    });

    it("detects a Python+pytest project", async () => {
      writeFile("requirements.txt", "selenium==4.0\npytest==8.0\n");
      writeFile("tests/test_login.py", "");
      writeFile("tests/test_checkout.py", "");
      writeFile("src/app.py", "");

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.listTestFiles.handler({ projectRoot: tmpDir });

      expect(result.content[0].text).toContain("**Language**: python");
      expect(result.content[0].text).toContain("**Framework**: selenium-js");
      expect(result.content[0].text).toContain("tests/test_login.py");
    });

    it("skips ignored directories (node_modules, dist, .git)", async () => {
      writeFile("package.json", JSON.stringify({ devDependencies: { jest: "^29" } }));
      writeFile("tests/real.test.ts", "");
      writeFile("node_modules/some-pkg/fake.test.ts", "");
      writeFile("dist/built.test.ts", "");

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.listTestFiles.handler({ projectRoot: tmpDir });

      expect(result.content[0].text).toContain("tests/real.test.ts");
      expect(result.content[0].text).not.toContain("node_modules");
      expect(result.content[0].text).not.toContain("dist/built");
    });

    it("returns a friendly message when nothing matches", async () => {
      writeFile("package.json", JSON.stringify({ devDependencies: { jest: "^29" } }));

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.listTestFiles.handler({ projectRoot: tmpDir });

      expect(result.content[0].text).toContain("No matching test files found");
    });

    it("rejects a non-existent project root", async () => {
      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.listTestFiles.handler({
        projectRoot: path.join(tmpDir, "does-not-exist"),
      });

      expect(result.isError).toBe(true);
    });

    it("caps results at maxResults", async () => {
      writeFile("package.json", JSON.stringify({ devDependencies: { jest: "^29" } }));
      for (let i = 0; i < 30; i++) writeFile(`tests/file${i}.test.ts`, "");

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.listTestFiles.handler({ projectRoot: tmpDir, maxResults: 5 });

      expect(result.content[0].text).toContain("cap reached");
    });

    it("detects a Java/Maven project", async () => {
      writeFile(
        "pom.xml",
        `<?xml version="1.0"?>
<project>
  <dependencies>
    <dependency><groupId>org.seleniumhq.selenium</groupId><artifactId>selenium-java</artifactId></dependency>
  </dependencies>
</project>`
      );
      writeFile("src/test/java/LoginTest.java", "");

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.listTestFiles.handler({ projectRoot: tmpDir });

      expect(result.content[0].text).toContain("**Language**: java");
      expect(result.content[0].text).toContain("**Framework**: selenium-js");
      expect(result.content[0].text).toContain("LoginTest.java");
    });

    it("falls back to unknown framework when no manifest exists", async () => {
      writeFile("tests/example.test.ts", "");

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.listTestFiles.handler({ projectRoot: tmpDir });

      expect(result.content[0].text).toContain("**Framework**: unknown");
    });
  });

  // ---------------------------------------------------------------------------
  // setupTestingBot
  // ---------------------------------------------------------------------------

  describe("setupTestingBot", () => {
    it("returns a Playwright config snippet", async () => {
      writeFile("package.json", JSON.stringify({ devDependencies: { "@playwright/test": "^1" } }));

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.setupTestingBot.handler({ projectRoot: tmpDir });

      expect(result.content[0].text).toContain("**Framework**: playwright");
      expect(result.content[0].text).toContain("playwright.config.ts");
      expect(result.content[0].text).toContain("wss://cloud.testingbot.com/playwright");
      expect(result.content[0].text).toContain("TESTINGBOT_KEY");
      expect(result.content[0].text).toContain("TESTINGBOT_SECRET");
    });

    it("returns a WebdriverIO config + install command", async () => {
      writeFile(
        "package.json",
        JSON.stringify({ devDependencies: { webdriverio: "^8" } })
      );
      writeFile("package-lock.json", "{}");

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.setupTestingBot.handler({ projectRoot: tmpDir });

      expect(result.content[0].text).toContain("**Framework**: webdriverio");
      expect(result.content[0].text).toContain("@wdio/testingbot-service");
      expect(result.content[0].text).toContain("npm install --save-dev");
    });

    it("uses pnpm install command when pnpm-lock.yaml is present", async () => {
      writeFile("package.json", JSON.stringify({ devDependencies: { webdriverio: "^8" } }));
      writeFile("pnpm-lock.yaml", "");

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.setupTestingBot.handler({ projectRoot: tmpDir });

      expect(result.content[0].text).toContain("pnpm add -D");
    });

    it("honours frameworkOverride", async () => {
      writeFile("package.json", JSON.stringify({ devDependencies: { jest: "^29" } }));

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.setupTestingBot.handler({
        projectRoot: tmpDir,
        frameworkOverride: "selenium-js",
      });

      expect(result.content[0].text).toContain("**Framework**: selenium-js (overridden)");
      expect(result.content[0].text).toContain("hub.testingbot.com/wd/hub");
    });

    it("returns a generic guide when no framework is detected", async () => {
      writeFile("README.md", "");

      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.setupTestingBot.handler({ projectRoot: tmpDir });

      expect(result.content[0].text).toContain("**Framework**: unknown");
      expect(result.content[0].text).toContain("hub.testingbot.com/wd/hub");
    });

    it("rejects a non-existent project root", async () => {
      const tools = addProjectTools(serverMock, testingBotApiMock, configMock);
      const result = await tools.setupTestingBot.handler({
        projectRoot: path.join(tmpDir, "missing"),
      });

      expect(result.isError).toBe(true);
    });
  });
});
