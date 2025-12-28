import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadCredentials,
  saveCredentials,
  credentialsExist,
  getCredentialsPath,
  createInitialCredentials,
  StoredCredentialsSchema,
} from "../../src/refresh/storage.js";
import type { StoredCredentials } from "../../src/slack/types.js";
import { RefreshError } from "../../src/utils/errors.js";

describe("StoredCredentialsSchema", () => {
  it("validates correct credentials", () => {
    const validCredentials = {
      version: 1,
      credentials: {
        token: "xoxc-valid-token",
        cookie: "xoxd-valid-cookie",
        workspace: "test-workspace",
      },
      metadata: {
        lastRefreshed: "2025-12-28T10:00:00.000Z",
        refreshCount: 5,
        source: "auto-refresh" as const,
      },
    };

    const result = StoredCredentialsSchema.safeParse(validCredentials);
    expect(result.success).toBe(true);
  });

  it("rejects token without xoxc- prefix", () => {
    const invalidCredentials = {
      version: 1,
      credentials: {
        token: "invalid-token",
        cookie: "xoxd-valid-cookie",
        workspace: "test-workspace",
      },
      metadata: {
        lastRefreshed: "2025-12-28T10:00:00.000Z",
        refreshCount: 0,
        source: "initial" as const,
      },
    };

    const result = StoredCredentialsSchema.safeParse(invalidCredentials);
    expect(result.success).toBe(false);
  });

  it("rejects cookie without xoxd- prefix", () => {
    const invalidCredentials = {
      version: 1,
      credentials: {
        token: "xoxc-valid-token",
        cookie: "invalid-cookie",
        workspace: "test-workspace",
      },
      metadata: {
        lastRefreshed: "2025-12-28T10:00:00.000Z",
        refreshCount: 0,
        source: "initial" as const,
      },
    };

    const result = StoredCredentialsSchema.safeParse(invalidCredentials);
    expect(result.success).toBe(false);
  });

  it("rejects empty workspace", () => {
    const invalidCredentials = {
      version: 1,
      credentials: {
        token: "xoxc-valid-token",
        cookie: "xoxd-valid-cookie",
        workspace: "",
      },
      metadata: {
        lastRefreshed: "2025-12-28T10:00:00.000Z",
        refreshCount: 0,
        source: "initial" as const,
      },
    };

    const result = StoredCredentialsSchema.safeParse(invalidCredentials);
    expect(result.success).toBe(false);
  });

  it("rejects invalid timestamp format", () => {
    const invalidCredentials = {
      version: 1,
      credentials: {
        token: "xoxc-valid-token",
        cookie: "xoxd-valid-cookie",
        workspace: "test-workspace",
      },
      metadata: {
        lastRefreshed: "not-a-timestamp",
        refreshCount: 0,
        source: "initial" as const,
      },
    };

    const result = StoredCredentialsSchema.safeParse(invalidCredentials);
    expect(result.success).toBe(false);
  });

  it("rejects negative refresh count", () => {
    const invalidCredentials = {
      version: 1,
      credentials: {
        token: "xoxc-valid-token",
        cookie: "xoxd-valid-cookie",
        workspace: "test-workspace",
      },
      metadata: {
        lastRefreshed: "2025-12-28T10:00:00.000Z",
        refreshCount: -1,
        source: "initial" as const,
      },
    };

    const result = StoredCredentialsSchema.safeParse(invalidCredentials);
    expect(result.success).toBe(false);
  });
});

describe("createInitialCredentials", () => {
  it("creates valid credentials from inputs", () => {
    const credentials = createInitialCredentials(
      "xoxc-test-token",
      "xoxd-test-cookie",
      "test-workspace"
    );

    expect(credentials.version).toBe(1);
    expect(credentials.credentials.token).toBe("xoxc-test-token");
    expect(credentials.credentials.cookie).toBe("xoxd-test-cookie");
    expect(credentials.credentials.workspace).toBe("test-workspace");
    expect(credentials.metadata.refreshCount).toBe(0);
    expect(credentials.metadata.source).toBe("initial");
    expect(new Date(credentials.metadata.lastRefreshed)).toBeInstanceOf(Date);
  });
});

describe("Storage operations", () => {
  const originalEnv = process.env;
  let testDir: string;
  let testCredentialsPath: string;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };

    // Create temp directory for tests
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-mcp-test-"));
    testCredentialsPath = path.join(testDir, "credentials.json");
    process.env.SLACK_CREDENTIALS_PATH = testCredentialsPath;
  });

  afterEach(() => {
    process.env = originalEnv;

    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("getCredentialsPath", () => {
    it("returns path from environment variable", () => {
      process.env.SLACK_CREDENTIALS_PATH = "/custom/path/credentials.json";
      expect(getCredentialsPath()).toBe("/custom/path/credentials.json");
    });

    it("returns default path when env var not set", () => {
      delete process.env.SLACK_CREDENTIALS_PATH;
      const result = getCredentialsPath();
      expect(result).toContain(".slack-mcp-server");
      expect(result).toContain("credentials.json");
    });
  });

  describe("credentialsExist", () => {
    it("returns false when file does not exist", () => {
      expect(credentialsExist()).toBe(false);
    });

    it("returns true when file exists", () => {
      const validCredentials = createInitialCredentials(
        "xoxc-test",
        "xoxd-test",
        "workspace"
      );
      fs.writeFileSync(testCredentialsPath, JSON.stringify(validCredentials));
      expect(credentialsExist()).toBe(true);
    });
  });

  describe("saveCredentials", () => {
    it("saves valid credentials to file", () => {
      const credentials = createInitialCredentials(
        "xoxc-test-token",
        "xoxd-test-cookie",
        "test-workspace"
      );

      saveCredentials(credentials);

      expect(fs.existsSync(testCredentialsPath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(testCredentialsPath, "utf-8"));
      expect(saved.credentials.token).toBe("xoxc-test-token");
    });

    it("creates parent directory if it does not exist", () => {
      const nestedPath = path.join(testDir, "nested", "deep", "credentials.json");
      process.env.SLACK_CREDENTIALS_PATH = nestedPath;

      const credentials = createInitialCredentials(
        "xoxc-test-token",
        "xoxd-test-cookie",
        "test-workspace"
      );

      saveCredentials(credentials);

      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it("throws RefreshError for invalid credentials", () => {
      const invalidCredentials = {
        version: 1,
        credentials: {
          token: "invalid-token", // Missing xoxc- prefix
          cookie: "xoxd-test-cookie",
          workspace: "test-workspace",
        },
        metadata: {
          lastRefreshed: new Date().toISOString(),
          refreshCount: 0,
          source: "initial" as const,
        },
      } as StoredCredentials;

      expect(() => saveCredentials(invalidCredentials)).toThrow(RefreshError);
    });

    it("sets correct file permissions (0600)", () => {
      const credentials = createInitialCredentials(
        "xoxc-test-token",
        "xoxd-test-cookie",
        "test-workspace"
      );

      saveCredentials(credentials);

      const stats = fs.statSync(testCredentialsPath);
      // On Unix, mode includes file type bits, so mask with 0o777
      const permissions = stats.mode & 0o777;
      expect(permissions).toBe(0o600);
    });
  });

  describe("loadCredentials", () => {
    it("loads valid credentials from file", () => {
      const originalCredentials = createInitialCredentials(
        "xoxc-test-token",
        "xoxd-test-cookie",
        "test-workspace"
      );
      saveCredentials(originalCredentials);

      const loaded = loadCredentials();

      expect(loaded.credentials.token).toBe("xoxc-test-token");
      expect(loaded.credentials.cookie).toBe("xoxd-test-cookie");
      expect(loaded.credentials.workspace).toBe("test-workspace");
    });

    it("throws RefreshError when file does not exist", () => {
      expect(() => loadCredentials()).toThrow(RefreshError);
      expect(() => loadCredentials()).toThrow(/not found/);
    });

    it("throws RefreshError for corrupted JSON", () => {
      fs.writeFileSync(testCredentialsPath, "{ invalid json }");

      expect(() => loadCredentials()).toThrow(RefreshError);
      expect(() => loadCredentials()).toThrow(/corrupted/);
    });

    it("throws RefreshError for invalid schema", () => {
      fs.writeFileSync(
        testCredentialsPath,
        JSON.stringify({
          version: 1,
          credentials: {
            token: "invalid-no-prefix",
            cookie: "xoxd-valid",
            workspace: "test",
          },
          metadata: {
            lastRefreshed: "2025-12-28T10:00:00.000Z",
            refreshCount: 0,
            source: "initial",
          },
        })
      );

      expect(() => loadCredentials()).toThrow(RefreshError);
      expect(() => loadCredentials()).toThrow(/Invalid credentials file format/);
    });
  });
});
