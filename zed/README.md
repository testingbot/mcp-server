# TestingBot MCP Server for Zed

A Zed extension that adds the [TestingBot MCP server](https://github.com/testingbot/mcp-server) to the Zed agent. It installs `@testingbot/mcp-server` from npm and keeps it up to date.

With it, the agent can drive TestingBot's real browsers and iOS/Android devices, run Selenium, Playwright, Appium and Maestro tests, take cross-browser screenshots, reach localhost through a tunnel, and explain why a test or build failed.

## Sign in

Leave the settings empty and ask the agent to sign in to TestingBot: it runs `tb_login`, which opens a sign-in page in your browser. Or set a key and secret in Zed's settings:

```json
{
  "context_servers": {
    "mcp-server-testingbot": {
      "settings": {
        "testingbot_key": "...",
        "testingbot_secret": "..."
      }
    }
  }
}
```

## Develop

Install Rust with rustup, then in Zed run **zed: install dev extension** and pick this `zed/` folder.
