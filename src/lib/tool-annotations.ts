/**
 * MCP tool annotations for this server's own tools. Clients use them to decide
 * when to ask before running a tool; directories such as Glama use them to rate
 * how well a tool is described. The browser (tb_*) and appium tools from
 * @testingbot/automation-mcp carry their own.
 *
 * A test fails when a tool is registered without an entry here.
 */
import {
  DESTRUCTIVE,
  READ,
  WRITE,
  WRITE_IDEMPOTENT,
  type ToolAnnotations,
} from "@testingbot/automation-mcp";

/** Reads this machine only (files, built-in docs); never calls TestingBot. */
const LOCAL_READ: ToolAnnotations = { ...READ, openWorldHint: false };

export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  // Account and team
  tb_login: { ...WRITE_IDEMPOTENT, title: "Log in to TestingBot" },
  getUserInfo: { ...READ, title: "Show my account" },
  updateUserInfo: { ...WRITE_IDEMPOTENT, title: "Update my account details" },
  getTeam: { ...READ, title: "Show team plan and concurrency" },
  getUsersInTeam: { ...READ, title: "List team members" },
  getUserFromTeam: { ...READ, title: "Show a team member" },

  // Browser and device catalog
  getBrowsers: { ...READ, title: "List browsers and emulators" },
  getDevices: { ...READ, title: "List real devices" },

  // Tests and builds
  getTests: { ...READ, title: "List recent tests" },
  getTestDetails: { ...READ, title: "Show a test" },
  getFailureLogs: { ...READ, title: "Read a test's logs" },
  updateTest: { ...WRITE_IDEMPOTENT, title: "Update a test's name or status" },
  deleteTest: { ...DESTRUCTIVE, title: "Delete a test" },
  stopTest: { ...DESTRUCTIVE, title: "Stop a running test" },
  getBuilds: { ...READ, title: "List builds" },
  getTestsForBuild: { ...READ, title: "List a build's tests" },
  deleteBuild: { ...DESTRUCTIVE, title: "Delete a build and its tests" },

  // AI failure analysis: starting one sends logs to the AI provider and counts
  // towards the account's AI limits; a current analysis is reused.
  getAiFailureAnalysis: { ...READ, title: "Read a test's AI failure analysis" },
  analyzeTestFailure: { ...WRITE, title: "Explain a test failure with AI" },

  // Live sessions: only build a dashboard link; the user presses Start.
  startLiveSession: { ...READ, title: "Link to a live session" },
  startDesktopLiveSession: { ...READ, title: "Link to a desktop live session" },
  startMobileLiveSession: { ...READ, title: "Link to a mobile live session" },

  // Remote browser for the user's own CDP client: starts a billed session.
  createCdpSession: { ...WRITE, title: "Start a browser for CDP" },

  // Screenshots
  takeScreenshot: { ...WRITE, title: "Screenshot a URL in many browsers" },
  retrieveScreenshots: { ...READ, title: "Get screenshot results" },
  getScreenshotList: { ...READ, title: "List screenshot jobs" },

  // Storage
  uploadFile: { ...WRITE, title: "Upload a local app" },
  uploadRemoteFile: { ...WRITE, title: "Upload an app from a URL" },
  getStorageFiles: { ...READ, title: "List uploaded apps" },
  deleteStorageFile: { ...DESTRUCTIVE, title: "Delete an uploaded app" },

  // Tunnels
  getTunnelList: { ...READ, title: "List running tunnels" },
  // Reuses a running tunnel with the same identifier.
  startTunnel: { ...WRITE_IDEMPOTENT, title: "Start a tunnel" },
  stopTunnel: { ...DESTRUCTIVE, title: "Stop a tunnel started here" },
  deleteTunnel: { ...DESTRUCTIVE, title: "Shut down a tunnel" },

  // Maestro
  maestroCheatSheet: { ...LOCAL_READ, title: "Maestro syntax reference" },
  // Reuses an upload of the same binary.
  uploadMaestroApp: { ...WRITE_IDEMPOTENT, title: "Upload an app for Maestro" },
  // Replaces the project's previously uploaded flows.
  uploadMaestroFlows: {
    ...WRITE_IDEMPOTENT,
    destructiveHint: true,
    title: "Upload Maestro flows",
  },
  uploadMaestroCompanionApp: { ...WRITE, title: "Upload a Maestro companion app" },
  runMaestroTest: { ...WRITE, title: "Run Maestro flows" },
  getMaestroRunStatus: { ...READ, title: "Check a Maestro run" },
  getMaestroRunResults: { ...READ, title: "Get Maestro run results" },
  getMaestroFlowDetails: { ...READ, title: "Show a Maestro flow's result" },
  listMaestroProjects: { ...READ, title: "List Maestro projects" },
  listMaestroRuns: { ...READ, title: "List Maestro runs" },
  cancelMaestroRun: { ...DESTRUCTIVE, title: "Cancel a Maestro run" },
  retryMaestroRun: { ...WRITE, title: "Retry a Maestro run" },

  // Espresso / XCUITest
  uploadAppAutomateApp: { ...WRITE, title: "Upload an app for Espresso/XCUITest" },
  uploadAppAutomateTests: { ...WRITE, title: "Upload an Espresso/XCUITest suite" },
  runAppAutomateTest: { ...WRITE, title: "Run Espresso/XCUITest" },
  getAppAutomateRunStatus: { ...READ, title: "Check an Espresso/XCUITest run" },
  getAppAutomateRunResults: { ...READ, title: "Get Espresso/XCUITest results" },

  // Visual review
  getVisualTests: { ...READ, title: "List visual tests" },
  getVisualRuns: { ...READ, title: "List visual runs" },
  explainVisualRun: { ...READ, title: "Explain a visual change" },
  // makeBaseline replaces the browser's baseline screenshot.
  reviewVisualRun: {
    ...WRITE_IDEMPOTENT,
    destructiveHint: true,
    title: "Approve or reject a visual run",
  },

  // Accessibility
  getAccessibilityTests: { ...READ, title: "List accessibility tests" },
  getAccessibilityRuns: { ...READ, title: "List accessibility scans" },
  getAccessibilityFindings: { ...READ, title: "Show accessibility findings" },
  runAccessibilityTest: { ...WRITE, title: "Run an accessibility scan now" },

  // Local project helpers
  listTestFiles: { ...LOCAL_READ, title: "Find test files in a project" },
  setupTestingBot: { ...LOCAL_READ, title: "Get TestingBot setup for a project" },
};
