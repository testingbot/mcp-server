# TestingBot plugin

Run and debug tests on [TestingBot](https://testingbot.com)'s cloud of real browsers and real iOS/Android devices without leaving your coding agent.

The same folder is a Claude Code plugin, a Cursor plugin and an [Agent Plugins](https://agent-plugins.org) package (Kiro powers), so every agent gets the same server and skills.

## Install

**Claude Code:**

```
/plugin marketplace add testingbot/mcp-server
/plugin install testingbot@testingbot
```

**Cursor:** install **TestingBot** from the Cursor Marketplace, or add this repository as a team marketplace.

**Kiro:** Powers → Add Custom Power → Import power from GitHub → `https://github.com/testingbot/mcp-server/tree/main/plugins/testingbot`.

Then sign in. The first time you use it, the agent runs `tb_login` for you (or ask it to "sign in to TestingBot"). It opens a browser sign-in and stores the credentials in `~/.testingbot/credentials`. If `TESTINGBOT_KEY` and `TESTINGBOT_SECRET` are already set in your environment (keys from [account settings](https://testingbot.com/members/user/security)), or you have signed in before, the server uses those and there is nothing to do.

## Try it

- "Sign in to TestingBot and show me which iPhones I can test on."
- "Open http://localhost:3000 in Safari on macOS on TestingBot and check that the signup form works."
- "Run my Playwright tests on TestingBot in Chrome, Firefox and Edge."
- "Take screenshots of https://example.com in the latest Chrome, Safari and on an Android phone, and point out layout differences."
- "Why did TestingBot test 0a1b2c3d fail?" (use a session ID from your dashboard)
- "Which of my tests were flaky in the last week?"

## What it adds

**The TestingBot MCP server** ([`@testingbot/mcp-server`](https://www.npmjs.com/package/@testingbot/mcp-server), run with `npx`, version pinned per plugin release). Its tools let the agent drive a remote browser or device step by step, start live sessions, take cross-browser screenshots, run Maestro, Espresso and XCUITest suites, open tunnels to localhost, and read tests, builds, logs and failure analysis. See the [tool list](https://github.com/testingbot/mcp-server#available-tools).

**Skills** (the agent uses them when your request matches; in Claude Code you can also run them as `/testingbot:<name>`):

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
