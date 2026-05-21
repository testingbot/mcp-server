import { describe, it, expect } from "vitest";
import {
  sanitizeSessionId,
  formatError,
  handleMCPError,
  validateUrl,
  sleep,
} from "../../src/lib/utils.js";

describe("sanitizeSessionId", () => {
  it("passes alphanumeric, dashes, and underscores through unchanged", () => {
    expect(sanitizeSessionId("abc-123_DEF")).toBe("abc-123_DEF");
  });

  it("strips path-traversal characters", () => {
    expect(sanitizeSessionId("../../etc/passwd")).toBe("etcpasswd");
  });

  it("strips whitespace, semicolons, and shell metacharacters", () => {
    expect(sanitizeSessionId("abc; rm -rf /")).toBe("abcrm-rf");
  });

  it("strips NUL bytes and control characters", () => {
    expect(sanitizeSessionId("abc\x00\n\tdef")).toBe("abcdef");
  });

  it("returns empty string when input contains nothing allowed", () => {
    expect(sanitizeSessionId("!@#$%^&*()")).toBe("");
  });
});

describe("formatError", () => {
  it("returns the message of an Error instance", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
  });

  it("returns the message of a custom Error subclass", () => {
    class CustomError extends Error {}
    expect(formatError(new CustomError("oops"))).toBe("oops");
  });

  it("stringifies non-Error values", () => {
    expect(formatError("plain string")).toBe("plain string");
    expect(formatError(42)).toBe("42");
    expect(formatError(null)).toBe("null");
    expect(formatError(undefined)).toBe("undefined");
  });
});

describe("validateUrl", () => {
  it("accepts well-formed http and https URLs", () => {
    expect(validateUrl("https://example.com")).toBe(true);
    expect(validateUrl("http://example.com:8080/path?q=1")).toBe(true);
  });

  it("accepts any URL parseable by WHATWG URL (including file:)", () => {
    // validateUrl is a syntactic check only — callers are responsible for
    // protocol allowlisting. This test pins that contract.
    expect(validateUrl("file:///etc/passwd")).toBe(true);
  });

  it("rejects malformed strings", () => {
    expect(validateUrl("not a url")).toBe(false);
    expect(validateUrl("")).toBe(false);
    expect(validateUrl("http://")).toBe(false);
  });
});

describe("handleMCPError", () => {
  it("returns a text content block with isError: true", () => {
    const result = handleMCPError("getTests", new Error("upstream timeout"));

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("upstream timeout");
  });

  it("converts camelCase tool names to a human-readable phrase", () => {
    const result = handleMCPError("getTestDetails", new Error("nope"));
    expect(result.content[0].text).toMatch(/Failed to get test details/);
  });

  it("handles non-Error throws", () => {
    const result = handleMCPError("doThing", "string error");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("string error");
  });
});

describe("sleep", () => {
  it("resolves after at least the given delay", async () => {
    const start = Date.now();
    await sleep(20);
    const elapsed = Date.now() - start;
    // Allow a generous lower bound to avoid flakiness on slow CI.
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });
});
