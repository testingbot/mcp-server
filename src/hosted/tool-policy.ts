// Which tools the hosted (HTTP) server offers, the OAuth scope each needs and
// the MCP annotations clients use to decide when to ask for confirmation
// (ChatGPT and Claude treat a tool without readOnlyHint as a write).
//
// Anything not listed here is not offered in hosted mode: tools that read or
// write the local filesystem (tb_login, setupTestingBot, listTestFiles, every
// upload that takes a local path), local processes (startTunnel/stopTunnel),
// cloud CDP sessions (Basic auth only), and the stateful browser/Appium
// automation tools.

export type HostedScope = "public" | "mcp:read" | "mcp:write";

export interface HostedToolPolicy {
  scope: HostedScope;
  title: string;
  destructive?: boolean;
  idempotent?: boolean;
}

const read = (title: string): HostedToolPolicy => ({ scope: "mcp:read", title, idempotent: true });
const write = (title: string, extra: Partial<HostedToolPolicy> = {}): HostedToolPolicy => ({
  scope: "mcp:write",
  title,
  ...extra,
});

export const HOSTED_TOOLS: Record<string, HostedToolPolicy> = {
  // Catalog: usable before sign-in.
  getBrowsers: { scope: "public", title: "List browsers", idempotent: true },
  getDevices: { scope: "public", title: "List devices", idempotent: true },
  maestroCheatSheet: { scope: "public", title: "Maestro cheat sheet", idempotent: true },

  getTests: read("List tests"),
  getTestDetails: read("Get test details"),
  getFailureLogs: read("Get failure logs"),
  getBuilds: read("List builds"),
  getTestsForBuild: read("List tests in a build"),
  getScreenshotList: read("List screenshot jobs"),
  retrieveScreenshots: read("Get screenshots"),
  getStorageFiles: read("List stored files"),
  getUserInfo: read("Get account info"),
  getTunnelList: read("List tunnels"),
  // These only build a /members/manual/start link; nothing starts until the
  // user opens it in their own signed-in browser.
  startLiveSession: read("Live session link"),
  startDesktopLiveSession: read("Desktop live session link"),
  startMobileLiveSession: read("Mobile live session link"),
  listMaestroProjects: read("List Maestro projects"),
  listMaestroRuns: read("List Maestro runs"),
  getMaestroRunStatus: read("Maestro run status"),
  getMaestroRunResults: read("Maestro run results"),
  getMaestroFlowDetails: read("Maestro flow details"),
  getAppAutomateRunStatus: read("Espresso/XCUITest run status"),
  getAppAutomateRunResults: read("Espresso/XCUITest run results"),

  updateTest: write("Update a test", { idempotent: true }),
  stopTest: write("Stop a test", { idempotent: true }),
  takeScreenshot: write("Take screenshots"),
  uploadRemoteFile: write("Store an app from a URL"),
  runMaestroTest: write("Run Maestro flows"),
  cancelMaestroRun: write("Cancel a Maestro run", { idempotent: true }),
  retryMaestroRun: write("Retry a Maestro run"),
  uploadMaestroFlows: write("Upload Maestro flows (inline)"),
  runAppAutomateTest: write("Run Espresso/XCUITest"),
};

// Deleting tests, builds, stored files and tunnels is held back in early
// access. MCP_HOSTED_DESTRUCTIVE_TOOLS=1 adds them (with destructiveHint).
export const HOSTED_DESTRUCTIVE_TOOLS: Record<string, HostedToolPolicy> = {
  deleteTest: write("Delete a test", { destructive: true, idempotent: true }),
  deleteBuild: write("Delete a build", { destructive: true, idempotent: true }),
  deleteStorageFile: write("Delete a stored file", { destructive: true, idempotent: true }),
  deleteTunnel: write("Stop and delete a tunnel", { destructive: true, idempotent: true }),
};

export function hostedToolPolicies(
  env: NodeJS.ProcessEnv = process.env
): Record<string, HostedToolPolicy> {
  return env.MCP_HOSTED_DESTRUCTIVE_TOOLS === "1"
    ? { ...HOSTED_TOOLS, ...HOSTED_DESTRUCTIVE_TOOLS }
    : { ...HOSTED_TOOLS };
}

export function annotationsFor(policy: HostedToolPolicy) {
  const readOnly = policy.scope !== "mcp:write";
  return {
    title: policy.title,
    readOnlyHint: readOnly,
    destructiveHint: readOnly ? false : Boolean(policy.destructive),
    idempotentHint: Boolean(policy.idempotent),
    openWorldHint: false,
  };
}
