---
name: why-did-my-test-fail
description: Investigate a failed TestingBot test (Selenium, Appium, Playwright, Cypress, Maestro, Espresso, XCUITest) and explain the cause with evidence. Use when the user gives a TestingBot session ID or test ID and asks why it failed.
---

# Why did my TestingBot test fail?

Needs the TestingBot MCP server (`@testingbot/mcp-server`). If a tool says no credentials are configured, call `tb_login` (it opens a browser sign-in) and continue; never ask the user to paste a key or secret.

1. Call `getTestDetails` with the session ID (or read the resource `testingbot://tests/<sessionId>`) for the status, status message, environment and which logs exist.
2. If the `analyzeTestFailure` tool is available, call it. If it says AI Analysis is not enabled for the account, do not push the user to enable it; continue with the logs.
3. Call `getFailureLogs` with `failuresOnly: true`. Read a full log (`testingbot://tests/<sessionId>/logs/<type>`) only when the failing lines are not enough.
4. Report:
   - what the test was doing and the step that failed;
   - the most likely cause, classified as application bug, test script, environment or flaky;
   - the log lines that show it (quoted);
   - one to three concrete fixes.

Say how sure you are. Do not claim a cause the logs do not show.
