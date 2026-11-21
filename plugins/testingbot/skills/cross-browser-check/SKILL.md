---
name: cross-browser-check
description: Take screenshots of a page in many browsers and devices at once on TestingBot and point out layout differences. Use when the user asks how a page looks in other browsers, on mobile, or wants a quick visual cross-browser check.
---

# Cross-browser visual check

Needs the TestingBot MCP server (`@testingbot/mcp-server`).

1. Get the URL. If it is `localhost` or private, call `startTunnel` first; screenshots go through the running tunnel.
2. Pick 4 to 8 targets with `getBrowsers`: the latest Chrome, Firefox, Edge and Safari, plus one or two mobile devices and an older version if the user cares about it. Ask if the user has a list.
3. Call `takeScreenshot` with the URL and browsers (`fullPage: true` for long pages). It returns a screenshot ID right away.
4. Wait about a minute, then call `retrieveScreenshots` with the ID. Repeat until every target is done.
5. Look at the images and report differences: broken layout, overflow, missing fonts or images, elements overlapping, mobile breakpoints. Name the browser for each issue and link the screenshots.

For interactive checks (clicking through a flow), use `tb_openBrowser` instead (see `test-localhost`).
