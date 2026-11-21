---
name: find-flaky-tests
description: Find flaky TestingBot tests (tests that both passed and failed recently) and suggest why each is unstable. Use when the user asks about flaky, intermittent or unstable tests on TestingBot.
---

# Find flaky TestingBot tests

Needs the TestingBot MCP server (`@testingbot/mcp-server`).

1. Read the resource `testingbot://insights/flaky-tests` (add `?time_range=7d` for a shorter window; the default is 30 days). It lists test names with pass rate and run counts, most flaky first.
2. For the top 5, call `getTests`, pick a recent failed and a recent passed run of each, and call `getFailureLogs` with `failuresOnly: true` on the failed one.
3. Look for timing problems (timeouts, waits, animations), order dependence, shared test data, or one environment failing more often than the others.
4. Report a ranked list: test name, pass rate, runs, the likely reason it is unstable, and a concrete change to make it stable.
