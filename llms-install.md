# Installing the TestingBot MCP server (instructions for AI agents)

This file tells an AI agent (Cline, Claude Code, Cursor, …) how to install
`@testingbot/mcp-server`. There is nothing to clone or build: the server is
published on npm and runs with `npx`.

## Requirements

- Node.js 20 or later (`node --version`). If it is older, ask the user to upgrade
  before continuing.
- A TestingBot account. The user can sign up at https://testingbot.com.

## 1. Add the server to the MCP settings

Add this entry to the client's MCP server configuration (for Cline:
`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "testingbot": {
      "command": "npx",
      "args": ["-y", "@testingbot/mcp-server"]
    }
  }
}
```

Keep any servers already in the file.

## 2. Credentials: pick one

**A. Sign in from the agent (recommended).** Leave the entry as above. After the
server starts, call the `tb_login` tool. It opens a TestingBot authorization page
in the browser (or, on a remote machine, returns a URL and a code for the user to
enter). When the user has clicked **Authorize**, call `tb_login` again if it asks
you to. The credentials are saved to `~/.testingbot/credentials` and used from then
on; no restart is needed.

**B. API key and secret.** If the user prefers, ask them for the key and secret
from https://testingbot.com/members/user/security and add them to the entry:

```json
"env": {
  "TESTINGBOT_KEY": "<key>",
  "TESTINGBOT_SECRET": "<secret>"
}
```

Never invent or guess credentials, and don't write placeholder values: when these
variables are set they take precedence over `tb_login`.

**Don't touch credential files yourself.** Never read, print, move, edit or
delete `~/.testingbot` (a `key:secret` file or a directory, depending on which
TestingBot tools the user has). Other TestingBot tools rely on it, and the server
reads it on its own. If the server reports no credentials, use `tb_login` or ask
the user.

## 3. Check that it works

Call `getUserInfo`. It should return the user's TestingBot account details. If it
says to run `tb_login`, the server has no credentials yet: go back to step 2.

## Notes

- Live sessions, test runs and screenshots use the user's TestingBot minutes.
  Ask before starting them.
- To test `localhost` or a private site, start a tunnel with `startTunnel` first.
