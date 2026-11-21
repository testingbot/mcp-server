# TestingBot plugin for Claude Code

Run and debug tests on [TestingBot](https://testingbot.com)'s cloud of real browsers and real iOS/Android devices without leaving Claude Code.

## Install

```
/plugin marketplace add testingbot/mcp-server
/plugin install testingbot@testingbot
```

Then sign in: ask Claude to "sign in to TestingBot". The `tb_login` tool opens a browser sign-in and stores the credentials in `~/.testingbot/credentials`. If `TESTINGBOT_KEY` and `TESTINGBOT_SECRET` are already set in your environment (keys from [account settings](https://testingbot.com/members/user/security)), or you have signed in before, the server uses those and there is nothing to do.

## What it adds

**The TestingBot MCP server** ([`@testingbot/mcp-server`](https://www.npmjs.com/package/@testingbot/mcp-server), run with `npx`, version pinned per plugin release). Its tools let Claude drive a remote browser or device step by step, start live sessions, take cross-browser screenshots, run Maestro, Espresso and XCUITest suites, open tunnels to localhost, and read tests, builds, logs and failure analysis. See the [tool list](https://github.com/testingbot/mcp-server#available-tools).

**Skills** (Claude uses them when your request matches, or run them as `/testingbot:<name>`):

| Skill | Use it to |
| --- | --- |
| `run-my-tests-on-testingbot` | Point your Playwright, Cypress, WebdriverIO, Selenium or Appium suite at TestingBot and run a first test |
| `test-localhost` | Open your local dev server in a remote browser or device through a TestingBot Tunnel |
| `run-maestro-flows` | Upload an app and Maestro flows and run them on real devices |
| `cross-browser-check` | Screenshot a page in several browsers at once and spot layout differences |
| `why-did-my-test-fail` | Explain a failed test from its logs and suggest fixes |
| `summarise-build` | Summarise a CI build and group failures by cause |
| `find-flaky-tests` | Find tests that both pass and fail and say why |

## What it runs and sends

- Starts `npx -y @testingbot/mcp-server@<version>` locally (downloads it from npm on first use).
- The server calls the TestingBot API (`api.testingbot.com`) and hub with your credentials. Tools that start browsers, devices, screenshots or test runs use your account's test minutes.
- `startTunnel` downloads and runs the TestingBot Tunnel (Java 17+) so remote browsers can reach localhost.
- `tb_login` signs you in through testingbot.com and writes `~/.testingbot/credentials`.
- Nothing else is sent anywhere. Privacy policy: https://testingbot.com/privacy

## Support

Issues: https://github.com/testingbot/mcp-server/issues · Docs: https://github.com/testingbot/mcp-server#readme

MIT licensed.
