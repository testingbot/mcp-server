# TestingBot

The `testingbot` MCP server connects you to TestingBot's cloud of real browsers and real iOS/Android devices.

- **Sign in first.** If a TestingBot tool says no credentials are configured, call `tb_login`. It opens a TestingBot sign-in page in the user's browser and saves the credentials in `~/.testingbot/credentials` once they approve. Never ask the user to paste their API key or secret into the chat.
- **Test minutes.** Tools that start browsers, devices, screenshots or test runs use the account's test minutes. Ask before starting more than a single test, and close remote browsers with `tb_closeBrowser` when done.
- **Localhost.** To reach a local dev server, call `startTunnel` first and pass its tunnel identifier to the browser or test run.
- **Failures.** For a failed test, start with `getTestDetails` and `getFailureLogs` (`failuresOnly: true`) before reading full logs.

Skills in this extension cover common workflows: running an existing test suite on TestingBot, testing localhost, running Maestro flows, cross-browser screenshots, explaining a failed test, summarising a build and finding flaky tests.
