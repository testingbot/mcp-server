---
name: run-maestro-flows
description: Upload a mobile app (APK/IPA/app zip) and Maestro flows to TestingBot and run them on real devices or emulators/simulators, then report the results. Use when the user wants to run Maestro tests in the cloud or on real devices.
---

# Run Maestro flows on TestingBot

Needs the TestingBot MCP server (`@testingbot/mcp-server`).

1. Find the app build and the flows. `listTestFiles` with the project root lists Maestro flows (`.maestro/` or `*.yaml`). Ask for the app path if it is not obvious (Android `.apk`, iOS simulator `.zip` or real-device `.ipa`).
2. If flows need writing or fixing, call `maestroCheatSheet` first.
3. `uploadMaestroApp` with the app path. It returns a `projectId`.
4. `uploadMaestroFlows` with that `projectId` and the flows folder (`flowsPath`).
5. `runMaestroTest` with `projectId` and `platformName` (`Android` or `iOS`). Add `deviceName` / `version` if the user named a device (`getDevices` lists them), `realDevice: true` for physical devices, and `tunnelIdentifier` if the app calls a local backend (start one with `startTunnel`).
6. The run is asynchronous. Poll `getMaestroRunStatus` every 30 seconds or so until it finishes, then call `getMaestroRunResults`.
7. Report pass/fail per flow and device, the failing step and its error, and links to the videos. For a failed flow, suggest a fix to the YAML.

Runs use the account's test minutes; ask before fanning out to many devices.
