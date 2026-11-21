---
name: run-my-tests-on-testingbot
description: Point an existing test suite (Playwright, Cypress, WebdriverIO, Selenium, Nightwatch, Puppeteer, Appium) at TestingBot's cloud browsers and devices. Use when the user asks to run their tests on TestingBot, in the cloud, on more browsers, or on real devices.
---

# Run my tests on TestingBot

Needs the TestingBot MCP server (`@testingbot/mcp-server`).

1. Call `listTestFiles` with the project root to see the framework and the tests that exist. If nothing is detected, ask the user which framework they use.
2. Call `setupTestingBot` with the project root. It returns the config snippet, install command and environment variables for that framework. It never edits files.
3. Show the user the changes, then apply them: add the snippet to the framework's config, keep the local setup working (gate the TestingBot config behind an env var or a separate config/project), and never write the key or secret into a file. They come from `TESTINGBOT_KEY` / `TESTINGBOT_SECRET`.
4. If the tests hit `localhost` or a private URL, call `startTunnel` first and pass its identifier as the framework's tunnel option.
5. Run one small test first (a single spec on one browser), using the command from step 2. Check the result with `getTests`; on failure, follow the `why-did-my-test-fail` steps.
6. Report what changed, how to run the suite on TestingBot, and the link to the test in the TestingBot dashboard.

If no credentials are configured, call `tb_login` to sign in. Running tests uses the account's test minutes, so ask before running the whole suite.
