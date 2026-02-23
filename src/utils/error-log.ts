import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const MAX_LINES = 1000;
const TRIM_TO = 500;

export interface ErrorLogEntry {
  ts: string;
  level: "error" | "warn";
  component: string;
  code: string;
  message: string;
  tool?: string;
  context?: Record<string, unknown>;
  attempt?: number;
  retryable?: boolean;
}

function getLogPath(): string {
  return (
    process.env.SLACK_ERROR_LOG_PATH ??
    path.join(os.homedir(), ".slack-mcp-server", "error.log")
  );
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function logError(entry: Omit<ErrorLogEntry, "ts">): void {
  try {
    const logPath = getLogPath();
    ensureDir(logPath);

    const fullEntry: ErrorLogEntry = {
      ts: new Date().toISOString(),
      ...entry,
    };
    const line = JSON.stringify(fullEntry) + "\n";

    fs.appendFileSync(logPath, line, "utf-8");

    // Rotate if over limit
    rotateIfNeeded(logPath);
  } catch {
    // Logging should never crash the server
  }
}

function rotateIfNeeded(logPath: string): void {
  try {
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    if (lines.length > MAX_LINES) {
      const trimmed = lines.slice(-TRIM_TO);
      fs.writeFileSync(logPath, trimmed.join("\n") + "\n", "utf-8");
    }
  } catch {
    // Ignore rotation errors
  }
}

export function readErrors(limit: number = 50): ErrorLogEntry[] {
  try {
    const logPath = getLogPath();

    if (!fs.existsSync(logPath)) {
      return [];
    }

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    // Newest first
    const entries: ErrorLogEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
      try {
        entries.push(JSON.parse(lines[i]!) as ErrorLogEntry);
      } catch {
        // Skip malformed lines
      }
    }

    return entries;
  } catch {
    return [];
  }
}

export function clearErrors(before?: string): {
  cleared: number;
  remaining: number;
} {
  try {
    const logPath = getLogPath();

    if (!fs.existsSync(logPath)) {
      return { cleared: 0, remaining: 0 };
    }

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    if (!before) {
      // Clear all
      fs.writeFileSync(logPath, "", "utf-8");
      return { cleared: lines.length, remaining: 0 };
    }

    // Clear entries before the given timestamp
    const beforeDate = new Date(before).getTime();
    const remaining: string[] = [];
    let cleared = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ErrorLogEntry;
        if (new Date(entry.ts).getTime() < beforeDate) {
          cleared++;
        } else {
          remaining.push(line);
        }
      } catch {
        // Keep malformed lines
        remaining.push(line);
      }
    }

    fs.writeFileSync(
      logPath,
      remaining.length > 0 ? remaining.join("\n") + "\n" : "",
      "utf-8"
    );

    return { cleared, remaining: remaining.length };
  } catch {
    return { cleared: 0, remaining: 0 };
  }
}
