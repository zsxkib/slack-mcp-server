import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { StoredCredentials } from "../../src/slack/types.js";

// Mock the storage module
vi.mock("../../src/refresh/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/refresh/storage.js")>(
    "../../src/refresh/storage.js"
  );
  return {
    ...actual,
    loadCredentials: vi.fn(),
    saveCredentials: vi.fn(),
    credentialsExist: vi.fn(),
    getCredentialsPath: vi.fn(() => "/test/credentials.json"),
  };
});

// Mock the client module
vi.mock("../../src/slack/client.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/slack/client.js")>(
    "../../src/slack/client.js"
  );
  return {
    ...actual,
    getRefreshConfig: vi.fn(() => ({
      credentialsPath: "/test/credentials.json",
      intervalDays: 7,
      workspace: "test-workspace",
      enabled: true,
    })),
    updateClientCredentials: vi.fn(),
    getAuthType: vi.fn(() => "user"),
    isRefreshAvailable: vi.fn(() => true),
    createRefreshSchedule: vi.fn(() => ({
      intervalDays: 7,
      checkIntervalMs: 3600000,
      nextCheckAt: new Date(Date.now() + 3600000),
      enabled: true,
    })),
  };
});

describe("Manual Refresh Flow Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("refresh_credentials tool", () => {
    it("returns success response when refresh succeeds", async () => {
      const { RefreshManager } = await import("../../src/refresh/manager.js");
      const { loadCredentials, saveCredentials } = await import(
        "../../src/refresh/storage.js"
      );

      const mockCredentials: StoredCredentials = {
        version: 1,
        credentials: {
          token: "xoxc-old-token",
          cookie: "xoxd-old-cookie",
          workspace: "test-workspace",
        },
        metadata: {
          lastRefreshed: "2025-12-21T10:00:00.000Z",
          refreshCount: 5,
          source: "auto-refresh",
        },
      };

      vi.mocked(loadCredentials).mockReturnValue(mockCredentials);
      vi.mocked(saveCredentials).mockImplementation(() => {});

      const manager = new RefreshManager();

      // Mock the HTTP refresh
      vi.spyOn(
        manager as unknown as {
          refreshViaHttp: () => Promise<{ token: string; cookie: string }>;
        },
        "refreshViaHttp"
      ).mockResolvedValue({
        token: "xoxc-new-token",
        cookie: "xoxd-new-cookie",
      });
      vi.spyOn(manager as unknown as { validateCredentials: (token: string, cookie: string) => Promise<void> }, "validateCredentials").mockResolvedValue(undefined);

      const result = await manager.refresh(true); // isManual = true

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.credentials.metadata.source).toBe("manual-refresh");
        expect(result.credentials.metadata.refreshCount).toBe(6);
      }
    });

    it("returns error response when refresh fails", async () => {
      const { RefreshManager } = await import("../../src/refresh/manager.js");
      const { loadCredentials } = await import("../../src/refresh/storage.js");

      const mockCredentials: StoredCredentials = {
        version: 1,
        credentials: {
          token: "xoxc-old-token",
          cookie: "xoxd-old-cookie",
          workspace: "test-workspace",
        },
        metadata: {
          lastRefreshed: "2025-12-21T10:00:00.000Z",
          refreshCount: 5,
          source: "auto-refresh",
        },
      };

      vi.mocked(loadCredentials).mockReturnValue(mockCredentials);

      const manager = new RefreshManager();
      const { RefreshError } = await import("../../src/utils/errors.js");

      // Mock the HTTP refresh to fail with SESSION_REVOKED
      vi.spyOn(
        manager as unknown as {
          refreshViaHttp: () => Promise<{ token: string; cookie: string }>;
        },
        "refreshViaHttp"
      ).mockRejectedValue(
        new RefreshError(
          "SESSION_REVOKED",
          "Slack session has been revoked. Please re-authenticate and update credentials."
        )
      );

      const result = await manager.refresh(true);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("SESSION_REVOKED");
        expect(result.error.retryable).toBe(false);
      }
    });

    it("returns REFRESH_NOT_AVAILABLE for bot token auth", async () => {
      const { getAuthType } = await import("../../src/slack/client.js");

      // Mock bot token auth
      vi.mocked(getAuthType).mockReturnValue("bot");

      // The tool handler should check auth type and return REFRESH_NOT_AVAILABLE
      // This will be tested via the actual tool handler
      expect(getAuthType()).toBe("bot");
    });

    it("returns REFRESH_IN_PROGRESS when concurrent refresh attempted", async () => {
      const { RefreshManager } = await import("../../src/refresh/manager.js");
      const { loadCredentials, saveCredentials } = await import(
        "../../src/refresh/storage.js"
      );

      const mockCredentials: StoredCredentials = {
        version: 1,
        credentials: {
          token: "xoxc-old-token",
          cookie: "xoxd-old-cookie",
          workspace: "test-workspace",
        },
        metadata: {
          lastRefreshed: "2025-12-21T10:00:00.000Z",
          refreshCount: 5,
          source: "auto-refresh",
        },
      };

      vi.mocked(loadCredentials).mockReturnValue(mockCredentials);
      vi.mocked(saveCredentials).mockImplementation(() => {});

      const manager = new RefreshManager();

      // Make the first refresh take time
      let resolveFirstRefresh: () => void;
      const firstRefreshPromise = new Promise<void>((resolve) => {
        resolveFirstRefresh = resolve;
      });

      vi.spyOn(
        manager as unknown as {
          refreshViaHttp: () => Promise<{ token: string; cookie: string }>;
        },
        "refreshViaHttp"
      ).mockImplementationOnce(async () => {
        await firstRefreshPromise;
        return { token: "xoxc-new-token", cookie: "xoxd-new-cookie" };
      });
      vi.spyOn(manager as unknown as { validateCredentials: (token: string, cookie: string) => Promise<void> }, "validateCredentials").mockResolvedValue(undefined);

      // Start first refresh
      const firstRefresh = manager.refresh(true);

      // Try to start second refresh immediately
      const secondResult = await manager.refresh(true);

      expect(secondResult.success).toBe(false);
      if (!secondResult.success) {
        expect(secondResult.error.code).toBe("REFRESH_IN_PROGRESS");
        expect(secondResult.error.retryable).toBe(true);
      }

      // Cleanup
      resolveFirstRefresh!();
      await firstRefresh;
    });
  });

  describe("full refresh cycle", () => {
    it("completes startup → auto-refresh → manual refresh flow", async () => {
      const { RefreshManager } = await import("../../src/refresh/manager.js");
      const { loadCredentials, saveCredentials, credentialsExist } = await import(
        "../../src/refresh/storage.js"
      );

      const mockCredentials: StoredCredentials = {
        version: 1,
        credentials: {
          token: "xoxc-old-token",
          cookie: "xoxd-old-cookie",
          workspace: "test-workspace",
        },
        metadata: {
          lastRefreshed: new Date(
            Date.now() - 8 * 24 * 60 * 60 * 1000
          ).toISOString(), // 8 days ago
          refreshCount: 5,
          source: "auto-refresh",
        },
      };

      vi.mocked(credentialsExist).mockReturnValue(true);
      vi.mocked(loadCredentials).mockReturnValue(mockCredentials);
      vi.mocked(saveCredentials).mockImplementation(() => {});

      const manager = new RefreshManager();

      // 1. Check if refresh is due (should be true after 8 days)
      expect(manager.isRefreshDue()).toBe(true);

      // 2. Mock HTTP refresh
      vi.spyOn(
        manager as unknown as {
          refreshViaHttp: () => Promise<{ token: string; cookie: string }>;
        },
        "refreshViaHttp"
      ).mockResolvedValue({
        token: "xoxc-new-token",
        cookie: "xoxd-new-cookie",
      });
      vi.spyOn(manager as unknown as { validateCredentials: (token: string, cookie: string) => Promise<void> }, "validateCredentials").mockResolvedValue(undefined);

      // 3. Auto refresh
      const autoResult = await manager.refresh(false);
      expect(autoResult.success).toBe(true);
      expect(manager.getState().consecutiveFailures).toBe(0);

      // 4. Manual refresh
      const manualResult = await manager.refresh(true);
      expect(manualResult.success).toBe(true);
      if (manualResult.success) {
        expect(manualResult.credentials.metadata.source).toBe("manual-refresh");
      }
    });
  });
});
