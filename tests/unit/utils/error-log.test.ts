import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let testDir: string;
let testLogPath: string;
const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "error-log-test-"));
  testLogPath = path.join(testDir, "error.log");
  process.env.SLACK_ERROR_LOG_PATH = testLogPath;
});

afterEach(() => {
  process.env = originalEnv;
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

describe("logError", () => {
  it("creates log file and appends entry", async () => {
    const { logError } = await import("../../../src/utils/error-log.js");

    logError({
      level: "error",
      component: "SlackAPI",
      code: "invalid_auth",
      message: "Invalid token",
    });

    expect(fs.existsSync(testLogPath)).toBe(true);
    const content = fs.readFileSync(testLogPath, "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.level).toBe("error");
    expect(entry.component).toBe("SlackAPI");
    expect(entry.code).toBe("invalid_auth");
    expect(entry.message).toBe("Invalid token");
    expect(entry.ts).toBeDefined();
  });

  it("appends multiple entries", async () => {
    const { logError } = await import("../../../src/utils/error-log.js");

    logError({ level: "error", component: "A", code: "e1", message: "first" });
    logError({ level: "warn", component: "B", code: "e2", message: "second" });

    const lines = fs
      .readFileSync(testLogPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).message).toBe("first");
    expect(JSON.parse(lines[1]!).message).toBe("second");
  });

  it("includes optional fields when provided", async () => {
    const { logError } = await import("../../../src/utils/error-log.js");

    logError({
      level: "error",
      component: "SlackAPI",
      code: "channel_not_found",
      message: "Not found",
      tool: "get_channel_history",
      context: { channelId: "C123" },
      retryable: false,
    });

    const content = fs.readFileSync(testLogPath, "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.tool).toBe("get_channel_history");
    expect(entry.context).toEqual({ channelId: "C123" });
    expect(entry.retryable).toBe(false);
  });

  it("creates parent directories if they do not exist", async () => {
    const nestedPath = path.join(testDir, "nested", "deep", "error.log");
    process.env.SLACK_ERROR_LOG_PATH = nestedPath;

    const { logError } = await import("../../../src/utils/error-log.js");

    logError({ level: "error", component: "Test", code: "t1", message: "ok" });

    expect(fs.existsSync(nestedPath)).toBe(true);
  });
});

describe("readErrors", () => {
  it("returns empty array when no log file", async () => {
    const { readErrors } = await import("../../../src/utils/error-log.js");
    const entries = readErrors();
    expect(entries).toEqual([]);
  });

  it("returns entries newest first", async () => {
    const { logError, readErrors } = await import(
      "../../../src/utils/error-log.js"
    );

    logError({ level: "error", component: "A", code: "e1", message: "first" });
    logError({ level: "error", component: "B", code: "e2", message: "second" });
    logError({ level: "error", component: "C", code: "e3", message: "third" });

    const entries = readErrors();
    expect(entries).toHaveLength(3);
    expect(entries[0]!.message).toBe("third");
    expect(entries[1]!.message).toBe("second");
    expect(entries[2]!.message).toBe("first");
  });

  it("respects limit parameter", async () => {
    const { logError, readErrors } = await import(
      "../../../src/utils/error-log.js"
    );

    for (let i = 0; i < 10; i++) {
      logError({
        level: "error",
        component: "Test",
        code: "e",
        message: `msg-${i}`,
      });
    }

    const entries = readErrors(3);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.message).toBe("msg-9");
  });

  it("skips malformed lines", async () => {
    fs.writeFileSync(
      testLogPath,
      '{"ts":"2026-01-01T00:00:00Z","level":"error","component":"A","code":"e1","message":"ok"}\nnot-json\n',
      "utf-8"
    );

    const { readErrors } = await import("../../../src/utils/error-log.js");
    const entries = readErrors();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.message).toBe("ok");
  });
});

describe("clearErrors", () => {
  it("clears all entries when no timestamp given", async () => {
    const { logError, clearErrors, readErrors } = await import(
      "../../../src/utils/error-log.js"
    );

    logError({ level: "error", component: "A", code: "e1", message: "test" });

    const result = clearErrors();
    expect(result.cleared).toBe(1);
    expect(result.remaining).toBe(0);
    expect(readErrors()).toHaveLength(0);
  });

  it("clears only entries before timestamp", async () => {
    // Write entries with explicit timestamps
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

    const { clearErrors, readErrors } = await import(
      "../../../src/utils/error-log.js"
    );

    const result = clearErrors("2026-03-01T00:00:00.000Z");
    expect(result.cleared).toBe(1);
    expect(result.remaining).toBe(1);

    const entries = readErrors();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.message).toBe("new");
  });

  it("returns zeros when log does not exist", async () => {
    const { clearErrors } = await import("../../../src/utils/error-log.js");
    const result = clearErrors();
    expect(result).toEqual({ cleared: 0, remaining: 0 });
  });
});

describe("log rotation", () => {
  it("trims to 500 lines when over 1000", async () => {
    const { logError, readErrors } = await import(
      "../../../src/utils/error-log.js"
    );

    // Write 1001 entries directly for speed
    const lines: string[] = [];
    for (let i = 0; i < 1001; i++) {
      lines.push(
        JSON.stringify({
          ts: new Date(Date.now() + i).toISOString(),
          level: "error",
          component: "Test",
          code: "e",
          message: `msg-${i}`,
        })
      );
    }
    fs.writeFileSync(testLogPath, lines.join("\n") + "\n", "utf-8");

    // Trigger rotation by writing one more entry
    logError({
      level: "error",
      component: "Test",
      code: "e",
      message: "trigger-rotation",
    });

    const content = fs.readFileSync(testLogPath, "utf-8");
    const remaining = content
      .split("\n")
      .filter((l) => l.trim().length > 0);

    // Should have been trimmed to 500 (from the original 1001+1)
    expect(remaining.length).toBeLessThanOrEqual(500);
    expect(remaining.length).toBeGreaterThan(0);

    // Newest entries should be preserved
    const entries = readErrors(5);
    expect(entries[0]!.message).toBe("trigger-rotation");
  });
});
