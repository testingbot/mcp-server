---
name: test-localhost
description: Open a site running on localhost or a private network in a real remote browser or mobile device on TestingBot, through a TestingBot Tunnel, and check it works. Use when the user wants to test their local dev server in Safari, Edge, an older browser, or on an iPhone/Android device.
---

# Test a local site on TestingBot

Needs the TestingBot MCP server (`@testingbot/mcp-server`) and Java 17+ on the machine (for the tunnel).

1. Confirm the local URL (for example `http://localhost:3000`) and that the dev server is running.
2. Call `startTunnel`. It waits until the tunnel is ready (up to a minute the first time) and returns a tunnel identifier.
3. Pick the target with `getBrowsers` (desktop) or `getDevices` (mobile) if the user did not name one.
4. Call `tb_openBrowser` with the browser, platform and `tunnelIdentifier`, then `tb_navigate` to the local URL. Use the same URL as on the machine; the tunnel routes it.
5. Use `tb_snapshot` to read the page and `tb_click` / `tb_type` to go through the flow the user cares about. Take `tb_screenshot` where something looks wrong.
6. Call `tb_closeBrowser` when done, then `stopTunnel` unless the user wants to keep testing.
7. Report what worked, what broke (with screenshots and console errors from `tb_executeScript` if useful) and the session link.

For a quick visual check across many browsers at once, use `takeScreenshot` instead (see `cross-browser-check`); it also goes through the running tunnel.
