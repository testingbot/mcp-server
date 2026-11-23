---
name: summarise-build
description: Summarise a TestingBot build (CI run) - pass/fail counts, failures grouped by shared cause, and what to fix first. Use when the user asks how a build or CI run went on TestingBot.
---

# Summarise a TestingBot build

Needs the TestingBot MCP server (`@testingbot/mcp-server`). If a tool says no credentials are configured, call `tb_login` (it opens a browser sign-in) and continue; never ask the user to paste a key or secret.

1. Find the build with `getBuilds` if you only have its name, then call `getTestsForBuild` (or read `testingbot://builds/<buildId>`).
2. Count passed, failed and unknown tests and list the environments (browser/OS or device) they ran on.
3. For each failed test (at most 10), call `getFailureLogs` with `failuresOnly: true`. If `getAiFailureAnalysis` is available, read existing analyses first; start new ones with `analyzeTestFailure` for at most 3 tests.
4. Group failures by shared cause: same error message, same environment, same step.
5. Report a one-line summary, a table of failure groups (cause, tests, environments) and what to fix first. Point out tests that fail in one environment only.
