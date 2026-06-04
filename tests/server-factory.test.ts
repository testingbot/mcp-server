import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TestingBotMcpServer } from "../src/server-factory.js";

describe("TestingBotMcpServer.preflight", () => {
  let testingBotApiMock: any;
  let configMock: any;
  const originalNode = process.versions.node;

  beforeEach(() => {
    testingBotApiMock = {
      getUserInfo: vi.fn().mockResolvedValue({ email: "ada@example.com" }),
    };
    configMock = {
      "testingbot-key": "k",
      "testingbot-secret": "s",
    };
  });

  afterEach(() => {
    Object.defineProperty(process.versions, "node", {
      value: originalNode,
      configurable: true,
    });
  });

  function setNodeVersion(version: string) {
    Object.defineProperty(process.versions, "node", {
      value: version,
      configurable: true,
    });
  }

  it("passes preflight with a supported Node version and valid credentials", async () => {
    setNodeVersion("20.10.0");
    const server = new TestingBotMcpServer(testingBotApiMock, configMock);
    await expect(server.preflight()).resolves.toBeUndefined();
    expect(testingBotApiMock.getUserInfo).toHaveBeenCalledOnce();
  });

  it("rejects unsupported Node versions before hitting the API", async () => {
    setNodeVersion("16.20.0");
    const server = new TestingBotMcpServer(testingBotApiMock, configMock);
    await expect(server.preflight()).rejects.toThrow(/Node.js 18\+ is required/);
    expect(testingBotApiMock.getUserInfo).not.toHaveBeenCalled();
  });

  it("starts in degraded mode (no throw) when api_key is missing", async () => {
    setNodeVersion("20.10.0");
    const server = new TestingBotMcpServer(testingBotApiMock, {
      "testingbot-key": "",
      "testingbot-secret": "s",
    });
    // Missing credentials no longer crash the server — tb_login can still run.
    await expect(server.preflight()).resolves.toBeUndefined();
    expect(testingBotApiMock.getUserInfo).not.toHaveBeenCalled();
  });

  it("starts in degraded mode (no throw) when api_secret is missing", async () => {
    setNodeVersion("20.10.0");
    const server = new TestingBotMcpServer(testingBotApiMock, {
      "testingbot-key": "k",
      "testingbot-secret": "",
    });
    await expect(server.preflight()).resolves.toBeUndefined();
    expect(testingBotApiMock.getUserInfo).not.toHaveBeenCalled();
  });

  it("registers the tb_login tool so degraded-mode users can authenticate", () => {
    setNodeVersion("20.10.0");
    const server = new TestingBotMcpServer(testingBotApiMock, {
      "testingbot-key": "",
      "testingbot-secret": "",
    });
    expect(server.tools.tb_login).toBeDefined();
    expect(server.tools.tb_login.name).toBe("tb_login");
  });

  it("wraps credential-check failures with a clear message", async () => {
    setNodeVersion("20.10.0");
    testingBotApiMock.getUserInfo.mockRejectedValue(new Error("401 Unauthorized"));
    const server = new TestingBotMcpServer(testingBotApiMock, configMock);
    await expect(server.preflight()).rejects.toThrow(/credential check failed.*401 Unauthorized/);
  });
});

describe("TestingBotMcpServer.handleToolCall (degraded-mode credential gate)", () => {
  let testingBotApiMock: any;

  beforeEach(() => {
    testingBotApiMock = {
      getUserInfo: vi.fn().mockResolvedValue({ email: "ada@example.com" }),
    };
  });

  function makeServer(key = "", secret = "") {
    return new TestingBotMcpServer(testingBotApiMock, {
      "testingbot-key": key,
      "testingbot-secret": secret,
    });
  }

  it("blocks a non-tb_login tool when credentials are missing", async () => {
    const server = makeServer();
    const handler = vi.fn();
    server.tools.dummy = { name: "dummy", handler };

    const res = await server.handleToolCall("dummy", {});

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("tb_login");
    expect(handler).not.toHaveBeenCalled();
  });

  it("exempts tb_login from the gate even with no credentials", async () => {
    const server = makeServer();
    const handler = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    server.tools.tb_login = { name: "tb_login", handler };

    await server.handleToolCall("tb_login", {});

    expect(handler).toHaveBeenCalledOnce();
  });

  it("dispatches normally once credentials appear (no restart)", async () => {
    const server = makeServer();
    const handler = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    server.tools.dummy = { name: "dummy", handler };

    // Simulate tb_login mutating the shared config in place.
    (server as any).config["testingbot-key"] = "k";
    (server as any).config["testingbot-secret"] = "s";

    const res = await server.handleToolCall("dummy", {});
    expect(handler).toHaveBeenCalledOnce();
    expect(res.content[0].text).toBe("ok");
  });

  it("throws for an unknown tool", async () => {
    const server = makeServer("k", "s");
    await expect(server.handleToolCall("nope", {})).rejects.toThrow(/Tool not found/);
  });
});
