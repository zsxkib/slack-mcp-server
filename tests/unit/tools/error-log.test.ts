import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let testDir: string;
let testLogPath: string;
const originalEnv = process.env;

// Mock server
vi.mock("../../../src/server.js", () => {
  const handlers = new Map<string, { opts: unknown; handler: Function }>();
  return {
    server: {
      registerTool: (name: string, opts: unknown, handler: Function) => {
        handlers.set(name, { opts, handler });
      },
      _handlers: handlers,
    },
  };
});

// Mock Slack client
vi.mock("../../../src/slack/client.js", () => ({
  getSlackClient: () => ({}),
  isSearchAvailable: () => false,
  isRefreshAvailable: () => false,
  getAuthType: () => "bot",
}));

let getErrorLog: Function;
let clearErrorLog: Function;

beforeEach(async () => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "error-log-tool-test-"));
  testLogPath = path.join(testDir, "error.log");
  process.env = { ...originalEnv };
  process.env.SLACK_ERROR_LOG_PATH = testLogPath;

  vi.resetModules();

  const serverModule = await import("../../../src/server.js");
  await import("../../../src/tools/error-log.js");

  const handlers = (serverModule.server as any)._handlers;
  getErrorLog = handlers.get("get_error_log")?.handler;
  clearErrorLog = handlers.get("clear_error_log")?.handler;
});

afterEach(() => {
  process.env = originalEnv;
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

describe("get_error_log", () => {
  it("returns empty when no log exists", async () => {
    const result = await getErrorLog({});
    const output = JSON.parse(result.content[0].text);
    expect(output.total).toBe(0);
    expect(output.entries).toEqual([]);
    expect(output.codeCounts).toEqual({});
  });

  it("returns entries with code counts", async () => {
    const { logError } = await import("../../../src/utils/error-log.js");

    logError({
      level: "error",
      component: "SlackAPI",
      code: "invalid_auth",
      message: "Bad token",
    });
    logError({
      level: "error",
      component: "SlackAPI",
      code: "invalid_auth",
      message: "Bad token again",
    });
    logError({
      level: "warn",
      component: "RefreshManager",
      code: "NETWORK_ERROR",
      message: "Connection failed",
    });

    const result = await getErrorLog({});
    const output = JSON.parse(result.content[0].text);

    expect(output.total).toBe(3);
    expect(output.codeCounts.invalid_auth).toBe(2);
    expect(output.codeCounts.NETWORK_ERROR).toBe(1);
    // Newest first
    expect(output.entries[0].code).toBe("NETWORK_ERROR");
  });

  it("respects limit parameter", async () => {
    const { logError } = await import("../../../src/utils/error-log.js");

    for (let i = 0; i < 10; i++) {
      logError({
        level: "error",
        component: "Test",
        code: "e",
        message: `msg-${i}`,
      });
    }

    const result = await getErrorLog({ limit: 3 });
    const output = JSON.parse(result.content[0].text);
    expect(output.total).toBe(3);
    expect(output.entries).toHaveLength(3);
  });

  it("is not marked as error response", async () => {
    const result = await getErrorLog({});
    expect(result.isError).toBeUndefined();
  });
});

describe("clear_error_log", () => {
  it("clears all entries", async () => {
    const { logError } = await import("../../../src/utils/error-log.js");

    logError({
      level: "error",
      component: "Test",
      code: "e",
      message: "test",
    });

    const result = await clearErrorLog({});
    const output = JSON.parse(result.content[0].text);
    expect(output.cleared).toBe(1);
    expect(output.remaining).toBe(0);

    // Verify log is empty
    const readResult = await getErrorLog({});
    const readOutput = JSON.parse(readResult.content[0].text);
    expect(readOutput.total).toBe(0);
  });

  it("clears entries before timestamp", async () => {
    const oldEntry = JSON.stringify({
      ts: "2026-01-01T00:00:00.000Z",
      level: "error",
      component: "A",
      code: "e1",
      message: "old",
    });
    const newEntry = JSON.stringify({
      ts: "2026-06-01T00:00:00.000Z",
      level: "error",
      component: "B",
      code: "e2",
      message: "new",
    });
    fs.writeFileSync(testLogPath, oldEntry + "\n" + newEntry + "\n", "utf-8");

    const result = await clearErrorLog({ before: "2026-03-01T00:00:00.000Z" });
    const output = JSON.parse(result.content[0].text);
    expect(output.cleared).toBe(1);
    expect(output.remaining).toBe(1);
  });
});
