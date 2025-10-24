# TestingBot MCP Server

[![NPM Version](https://img.shields.io/npm/v/@testingbot/mcp-server)](https://www.npmjs.com/package/@testingbot/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TestingBot's official Model Context Protocol (MCP) server implementation. This server enables AI assistants to interact with TestingBot's testing infrastructure, allowing you to manage tests, browsers, devices, and more through conversational interfaces.

## Features

- 🖥️ **Live Testing** - Start interactive manual testing sessions on real browsers and devices
- 🌐 **Browser & Device Management** - Query available browsers and real devices
- 🧪 **Test Management** - Create, retrieve, update, and delete tests with comprehensive details
- 📦 **Storage Management** - Upload and manage mobile app files (APK, IPA)
- 📸 **Screenshot Testing** - Take cross-browser screenshots
- 🏗️ **Build Management** - Organize tests into builds
- 👤 **User Account** - View and update account information
- 👥 **Team Management** - Manage team settings and team members
- 🔌 **Chrome DevTools Protocol** - Create CDP sessions for advanced browser automation
- 🚇 **Tunnel Management** - Manage TestingBot tunnels for local testing

## Prerequisites

- **Node.js** >= 18 (recommended: 22.15.0 or later)
- **TestingBot Account** with API credentials
- An MCP-compatible client (Claude Desktop, VS Code with Continue, Cursor, etc.)

## Installation

### Quick Setup

Install the MCP server globally:

```bash
npm install -g @testingbot/mcp-server
```

Or add to your project:

```bash
npm install @testingbot/mcp-server
```

### Configuration

#### Environment Variables

Set your TestingBot credentials as environment variables:

```bash
export TESTINGBOT_KEY="your-api-key"
export TESTINGBOT_SECRET="your-api-secret"
```

Or create a `.env` file in your project:

```
TESTINGBOT_KEY=your-api-key
TESTINGBOT_SECRET=your-api-secret
```

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%/Claude/claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "testingbot": {
      "command": "npx",
      "args": ["-y", "@testingbot/mcp-server"],
      "env": {
        "TESTINGBOT_KEY": "your-api-key",
        "TESTINGBOT_SECRET": "your-api-secret"
      }
    }
  }
}
```

#### VS Code (with Continue extension)

Add to `.continue/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "testingbot",
      "command": "npx",
      "args": ["-y", "@testingbot/mcp-server"],
      "env": {
        "TESTINGBOT_KEY": "your-api-key",
        "TESTINGBOT_SECRET": "your-api-secret"
      }
    }
  ]
}
```

#### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "testingbot": {
      "command": "npx",
      "args": ["-y", "@testingbot/mcp-server"],
      "env": {
        "TESTINGBOT_KEY": "your-api-key",
        "TESTINGBOT_SECRET": "your-api-secret"
      }
    }
  }
}
```

## Available Tools

### Live Testing

#### `startLiveSession`
Start an interactive live testing session on TestingBot. Opens a real browser or mobile device for manual testing.

**Parameters:**
- `platformType`: "desktop" or "mobile"
- `desiredURL`: The URL to open
- `desiredOS`: Operating system (Windows, Mac, Linux for desktop; android, ios for mobile)
- `desiredOSVersion`: OS version
- `desiredBrowser` (desktop only): Browser name (chrome, firefox, safari, edge, ie)
- `desiredBrowserVersion` (desktop only): Browser version or "latest"
- `desiredDevice` (mobile only): Device name (e.g., "iPhone 14", "Galaxy S23")

**Example prompts:**
> "Start a live testing session on Chrome latest with Windows 11 for https://example.com"
> "Open https://myapp.com on iPhone 14 with iOS 16 for manual testing"

#### `startDesktopLiveSession`
Convenience tool to start a desktop browser live testing session.

**Parameters:**
- `desiredURL`: The URL to open
- `desiredOS`: Windows, Mac, or Linux
- `desiredOSVersion`: OS version
- `desiredBrowser`: chrome, firefox, safari, edge, or ie
- `desiredBrowserVersion` (optional): Browser version or "latest" (default: latest)

**Example prompt:**
> "Start desktop live session on Firefox 120 with Mac Monterey for https://example.com"

#### `startMobileLiveSession`
Convenience tool to start a mobile device live testing session.

**Parameters:**
- `desiredURL`: The URL to open
- `desiredOS`: android or ios
- `desiredOSVersion`: OS version
- `desiredDevice`: Device name

**Example prompt:**
> "Start mobile live session on Galaxy S23 with Android 13 for https://example.com"

### Browser & Device Management

#### `getBrowsers`
Get list of available browsers and platforms for testing.

**Parameters:**
- `type` (optional): Filter by "web" or "mobile"

**Example prompt:**
> "Show me all available browsers for testing"
> "What mobile browsers are available?"

#### `getDevices`
Get list of available mobile devices (real devices and simulators).

**Example prompt:**
> "List all available iOS devices"
> "Show me Android devices for testing"

### Test Management

#### `getTests`
Retrieve a list of recent tests with pagination.

**Parameters:**
- `offset` (optional): Pagination offset (default: 0)
- `limit` (optional): Number of tests to retrieve (default: 10, max: 100)

**Example prompt:**
> "Show me my last 20 tests"
> "Get recent test results"

#### `getTestDetails`
Get comprehensive details about a specific test including:
- Test status, browser, platform, and timing information
- Video recording URL and screenshot URLs
- Selenium, browser, and Appium logs
- Test execution steps with commands and timestamps
- Network logs, exception logs, and JS errors

**Parameters:**
- `sessionId`: The session ID of the test

**Example prompt:**
> "Get details for test session abc123"
> "Show me the video and logs for test xyz789"
> "Show execution steps for test abc123"

#### `updateTest`
Update test metadata such as name, status, or build.

**Parameters:**
- `sessionId`: The session ID of the test
- `name` (optional): New name for the test
- `status` (optional): "passed" or "failed"
- `build` (optional): Build identifier
- `extra` (optional): Additional metadata (JSON string)

**Example prompt:**
> "Mark test abc123 as passed"
> "Update test xyz789 with name 'Login Flow Test'"

#### `deleteTest`
Delete a test by session ID.

**Parameters:**
- `sessionId`: The session ID of the test to delete

**Example prompt:**
> "Delete test abc123"

#### `stopTest`
Stop a running test by session ID.

**Parameters:**
- `sessionId`: The session ID of the test to stop

**Example prompt:**
> "Stop test abc123"

### Build Management

#### `getBuilds`
Get a list of builds with pagination.

**Parameters:**
- `offset` (optional): Pagination offset (default: 0)
- `limit` (optional): Number of builds to retrieve (default: 10, max: 100)

**Example prompt:**
> "Show me my recent builds"

#### `getTestsForBuild`
Get all tests associated with a specific build ID.

**Parameters:**
- `buildId`: The build ID

**Example prompt:**
> "Show all tests for build 12345"

#### `deleteBuild`
Delete a build and all its associated tests.

**Parameters:**
- `buildId`: The build ID to delete

**Example prompt:**
> "Delete build 12345"

### Storage Management

#### `uploadFile`
Upload a local file (APK, IPA, or ZIP) to TestingBot storage.

**Parameters:**
- `localFilePath`: Path to the file to upload

**Example prompt:**
> "Upload /path/to/app.apk to TestingBot"

#### `uploadRemoteFile`
Upload a file from a remote URL to TestingBot storage.

**Parameters:**
- `remoteUrl`: URL of the file to upload

**Example prompt:**
> "Upload https://example.com/app.ipa to TestingBot"

#### `getStorageFiles`
List all files in TestingBot storage.

**Parameters:**
- `offset` (optional): Pagination offset (default: 0)
- `limit` (optional): Number of files to retrieve (default: 10, max: 100)

**Example prompt:**
> "Show me all uploaded apps"

#### `deleteStorageFile`
Delete a file from TestingBot storage.

**Parameters:**
- `appUrl`: The app_url of the file to delete

**Example prompt:**
> "Delete app tb://app123 from storage"

### Screenshot Testing

#### `takeScreenshot`
Take screenshots of a URL across multiple browsers and platforms.

**Parameters:**
- `url`: The URL to screenshot
- `browsers`: Array of browser configurations
  - `browserName`: Browser name (chrome, firefox, safari, etc.)
  - `version` (optional): Browser version or "latest"
  - `os`: Operating system (WIN11, MAC, etc.)
- `resolution` (optional): Screen resolution (default: "1920x1080")
- `waitTime` (optional): Seconds to wait before screenshot (default: 5, max: 60)
- `fullPage` (optional): Capture full page or viewport (default: false)

**Example prompt:**
> "Take a screenshot of https://example.com on Chrome and Firefox"
> "Screenshot my homepage on mobile devices"

#### `retrieveScreenshots`
Retrieve screenshot results by screenshot ID.

**Parameters:**
- `screenshotId`: The screenshot ID from takeScreenshot

**Example prompt:**
> "Get screenshots for job abc123"

#### `getScreenshotList`
Get a list of all screenshot jobs.

**Parameters:**
- `offset` (optional): Pagination offset (default: 0)
- `limit` (optional): Number of jobs to retrieve (default: 10, max: 100)

**Example prompt:**
> "Show me my recent screenshot jobs"

### User Management

#### `getUserInfo`
Get current user account information including minutes used, plan details, and limits.

**Example prompt:**
> "Show my account information"
> "How many minutes have I used?"

#### `updateUserInfo`
Update user account information.

**Parameters:**
- `firstName` (optional): First name
- `lastName` (optional): Last name
- `email` (optional): Email address

**Example prompt:**
> "Update my email to newemail@example.com"

### Team Management

#### `getTeam`
Get team information including concurrency limits, allowed parallel VMs, and mobile concurrency.

**Example prompt:**
> "Show my team information"
> "What are my team's concurrency limits?"

#### `getUsersInTeam`
List all users in your team with their roles and access levels.

**Parameters:**
- `offset` (optional): Pagination offset (default: 0)
- `limit` (optional): Number of users to retrieve (default: 10, max: 100)

**Example prompt:**
> "Show me all team members"
> "List users in my team"

#### `getUserFromTeam`
Get detailed information about a specific team member by user ID.

**Parameters:**
- `userId`: The user ID to retrieve

**Example prompt:**
> "Show details for user 12345"

### Chrome DevTools Protocol (CDP)

#### `createCdpSession`
Create a Chrome DevTools Protocol session for advanced browser automation. Returns a WebSocket URL to connect to the browser.

**Parameters:**
- `browserName`: Browser name (chrome, firefox, safari, edge, etc.)
- `browserVersion` (optional): Browser version or "latest" (default: latest)
- `platform`: Operating system platform
- `screenResolution` (optional): Screen resolution (e.g., "1920x1080")
- `name` (optional): Session name
- `build` (optional): Build identifier

**Example prompt:**
> "Create a CDP session on Chrome latest with Windows 11"
> "Start a CDP session on Firefox 120 for automation"

### Tunnel Management

#### `getTunnelList`
Get a list of all active TestingBot tunnels. Tunnels allow testing websites behind firewalls or on your local machine.

**Example prompt:**
> "Show me all active tunnels"
> "List my TestingBot tunnels"

#### `deleteTunnel`
Delete an active TestingBot tunnel by ID. This terminates the tunnel connection.

**Parameters:**
- `tunnelId`: The tunnel ID to delete

**Example prompt:**
> "Delete tunnel 12345"

## Usage Examples

### Example 1: Running Cross-Browser Tests

```
User: "Show me all available browsers for web testing"
Assistant: [Lists all web browsers]

User: "Take a screenshot of https://myapp.com on Chrome latest and Firefox latest on Windows 11"
Assistant: [Creates screenshot job and returns ID]

User: "Get the screenshots for job abc123"
Assistant: [Returns screenshot URLs]
```

### Example 2: Managing Mobile App Tests

```
User: "Upload my app from https://example.com/app.apk"
Assistant: [Uploads app and returns tb://app123]

User: "Show me all my uploaded apps"
Assistant: [Lists storage files]

User: "Show me the last 10 tests"
Assistant: [Shows recent test results]
```

### Example 3: Build Management

```
User: "Show me my recent builds"
Assistant: [Lists recent builds]

User: "Show all tests for build 12345"
Assistant: [Lists tests in that build]

User: "Mark test xyz789 as passed with build name 'Release 1.0'"
Assistant: [Updates test]
```

### Example 4: Team & Tunnel Management

```
User: "Show me my team information"
Assistant: [Shows team concurrency limits and settings]

User: "List all team members"
Assistant: [Lists all users in the team]

User: "Show me all active tunnels"
Assistant: [Lists active TestingBot tunnels]
```

### Example 5: CDP Automation

```
User: "Create a CDP session on Chrome latest with Windows 11"
Assistant: [Creates session and returns WebSocket URL]

User: "Show me test execution steps for session abc123"
Assistant: [Shows detailed command history with timestamps]
```

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/testingbot/mcp-server.git
cd testingbot-mcp-server

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials
```

### Commands

```bash
# Build the project (runs lint, format, test, and compile)
npm run build

# Development mode with watch
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

### Running Locally

```bash
# Development mode
npm run dev

# Production mode
npm start
```

### Testing with MCP Inspector

Use the MCP Inspector to test tools during development:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Then open http://localhost:5173 in your browser.

## Project Structure

```
testingbot-mcp-server/
├── src/
│   ├── index.ts              # Entry point
│   ├── server-factory.ts     # MCP server setup
│   ├── config.ts             # Configuration management
│   ├── lib/
│   │   ├── types.ts          # TypeScript types
│   │   ├── constants.ts      # Constants and enums
│   │   ├── error.ts          # Error classes
│   │   ├── logger.ts         # Logging setup
│   │   ├── utils.ts          # Utility functions
│   │   └── get-auth.ts       # Authentication helpers
│   └── tools/
│       ├── browsers.ts       # Browser & device tools
│       ├── tests.ts          # Test management tools
│       ├── builds.ts         # Build management tools
│       ├── storage.ts        # Storage tools
│       ├── screenshots.ts    # Screenshot tools
│       ├── user.ts           # User management tools
│       ├── team.ts           # Team management tools
│       ├── cdp.ts            # Chrome DevTools Protocol tools
│       ├── tunnels.ts        # Tunnel management tools
│       └── live.ts           # Live testing session tools
├── tests/
│   └── tools/                # Unit tests
├── dist/                     # Compiled output
└── package.json
```

## Troubleshooting

### Authentication Errors

If you see authentication errors:
1. Verify your credentials at https://testingbot.com/members/user/edit
2. Ensure environment variables are set correctly
3. Check that there are no extra spaces in your credentials

### Connection Issues

If the MCP server won't connect:
1. Restart your MCP client (Claude Desktop, VS Code, etc.)
2. Check the MCP client logs for errors
3. Verify Node.js version is >= 18

### Tool Execution Errors

If tools fail to execute:
1. Check the server logs for detailed error messages
2. Verify you have sufficient permissions/quota in your TestingBot account
3. Ensure all required parameters are provided

### Debug Logging

To enable debug logging, set the `LOG_LEVEL` environment variable:

```bash
export LOG_LEVEL=debug
```

Or in your MCP client configuration:

```json
{
  "mcpServers": {
    "testingbot": {
      "command": "npx",
      "args": ["-y", "@testingbot/mcp-server"],
      "env": {
        "TESTINGBOT_KEY": "your-api-key",
        "TESTINGBOT_SECRET": "your-api-secret",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 📧 Email: support@testingbot.com
- 🐛 Issues: [GitHub Issues](https://github.com/testingbot/mcp-server/issues)
- 📖 Documentation: [TestingBot Documentation](https://testingbot.com/support)
- 💬 Community: [TestingBot Forum](https://testingbot.com/support/forums)

## Related

- [TestingBot API Package](https://github.com/testingbot/testingbot-api)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [TestingBot Platform](https://testingbot.com)
