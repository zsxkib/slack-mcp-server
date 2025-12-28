import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { RefreshState, StoredCredentials } from "../../src/slack/types.js";
import { RefreshError } from "../../src/utils/errors.js";

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
    getSlackClient: vi.fn(() => ({
      auth: {
        test: vi.fn().mockResolvedValue({ ok: true, user_id: "U123" }),
      },
    })),
  };
});

describe("RefreshManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getState", () => {
    it("returns initial idle state", async () => {
      const { RefreshManager } = await import("../../src/refresh/manager.js");
      const manager = new RefreshManager();

      const state = manager.getState();

      expect(state.status).toBe("idle");
      expect(state.lastAttempt).toBeNull();
      expect(state.lastSuccess).toBeNull();
      expect(state.lastError).toBeNull();
      expect(state.consecutiveFailures).toBe(0);
      expect(state.isManualTrigger).toBe(false);
    });
  });

  describe("refresh flow", () => {
    it("transitions state from idle to in_progress to succeeded", async () => {
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

      // Mock the internal HTTP refresh method
      vi.spyOn(manager as unknown as { refreshViaHttp: () => Promise<{ token: string; cookie: string }> }, "refreshViaHttp").mockResolvedValue({
        token: "xoxc-new-token",
        cookie: "xoxd-new-cookie",
      });
      vi.spyOn(manager as unknown as { validateCredentials: (token: string, cookie: string) => Promise<void> }, "validateCredentials").mockResolvedValue(undefined);

      const result = await manager.refresh();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.credentials.credentials.token).toBe("xoxc-new-token");
        expect(result.credentials.credentials.cookie).toBe("xoxd-new-cookie");
      }

      const state = manager.getState();
      expect(state.status).toBe("idle"); // Returns to idle after success
      expect(state.lastSuccess).not.toBeNull();
      expect(state.consecutiveFailures).toBe(0);
    });

    it("increments refreshCount on successful refresh", async () => {
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

      let savedCredentials: StoredCredentials | null = null;
      vi.mocked(saveCredentials).mockImplementation((creds) => {
        savedCredentials = creds;
      });

      const manager = new RefreshManager();
      vi.spyOn(manager as unknown as { refreshViaHttp: () => Promise<{ token: string; cookie: string }> }, "refreshViaHttp").mockResolvedValue({
        token: "xoxc-new-token",
        cookie: "xoxd-new-cookie",
      });
      vi.spyOn(manager as unknown as { validateCredentials: (token: string, cookie: string) => Promise<void> }, "validateCredentials").mockResolvedValue(undefined);

      await manager.refresh();

      expect(savedCredentials).not.toBeNull();
      expect(savedCredentials!.metadata.refreshCount).toBe(6);
    });

    it("sets correct source for auto refresh", async () => {
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
          refreshCount: 0,
          source: "initial",
        },
      };

      vi.mocked(loadCredentials).mockReturnValue(mockCredentials);

      let savedCredentials: StoredCredentials | null = null;
      vi.mocked(saveCredentials).mockImplementation((creds) => {
        savedCredentials = creds;
      });

      const manager = new RefreshManager();
      vi.spyOn(manager as unknown as { refreshViaHttp: () => Promise<{ token: string; cookie: string }> }, "refreshViaHttp").mockResolvedValue({
        token: "xoxc-new-token",
        cookie: "xoxd-new-cookie",
      });
      vi.spyOn(manager as unknown as { validateCredentials: (token: string, cookie: string) => Promise<void> }, "validateCredentials").mockResolvedValue(undefined);

      await manager.refresh(false); // auto refresh

      expect(savedCredentials!.metadata.source).toBe("auto-refresh");
    });

    it("sets correct source for manual refresh", async () => {
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
          refreshCount: 0,
          source: "initial",
        },
      };

      vi.mocked(loadCredentials).mockReturnValue(mockCredentials);

      let savedCredentials: StoredCredentials | null = null;
      vi.mocked(saveCredentials).mockImplementation((creds) => {
        savedCredentials = creds;
      });

      const manager = new RefreshManager();
      vi.spyOn(manager as unknown as { refreshViaHttp: () => Promise<{ token: string; cookie: string }> }, "refreshViaHttp").mockResolvedValue({
        token: "xoxc-new-token",
        cookie: "xoxd-new-cookie",
      });
      vi.spyOn(manager as unknown as { validateCredentials: (token: string, cookie: string) => Promise<void> }, "validateCredentials").mockResolvedValue(undefined);

      await manager.refresh(true); // manual refresh

      expect(savedCredentials!.metadata.source).toBe("manual-refresh");
    });
  });

  describe("isRefreshDue", () => {
    it("returns true when last refresh exceeds interval", async () => {
      const { RefreshManager } = await import("../../src/refresh/manager.js");
      const { loadCredentials, credentialsExist } = await import("../../src/refresh/storage.js");

      // Set last refresh to 8 days ago (exceeds 7 day interval)
      const eightDaysAgo = new Date();
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

      const mockCredentials: StoredCredentials = {
        version: 1,
        credentials: {
          token: "xoxc-test",
          cookie: "xoxd-test",
          workspace: "test-workspace",
        },
        metadata: {
          lastRefreshed: eightDaysAgo.toISOString(),
          refreshCount: 5,
          source: "auto-refresh",
        },
      };

      vi.mocked(credentialsExist).mockReturnValue(true);
      vi.mocked(loadCredentials).mockReturnValue(mockCredentials);

      const manager = new RefreshManager();
      expect(manager.isRefreshDue()).toBe(true);
    });

    it("returns false when last refresh is within interval", async () => {
      const { RefreshManager } = await import("../../src/refresh/manager.js");
      const { loadCredentials, credentialsExist } = await import("../../src/refresh/storage.js");

      // Set last refresh to 3 days ago (within 7 day interval)
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const mockCredentials: StoredCredentials = {
        version: 1,
        credentials: {
          token: "xoxc-test",
          cookie: "xoxd-test",
          workspace: "test-workspace",
        },
        metadata: {
          lastRefreshed: threeDaysAgo.toISOString(),
          refreshCount: 5,
          source: "auto-refresh",
        },
      };

      vi.mocked(credentialsExist).mockReturnValue(true);
      vi.mocked(loadCredentials).mockReturnValue(mockCredentials);

      const manager = new RefreshManager();
      expect(manager.isRefreshDue()).toBe(false);
    });
  });

  describe("error classification", () => {
    it("classifies NETWORK_ERROR as retryable", async () => {
      const { isRetryableRefreshError } = await import(
        "../../src/utils/errors.js"
      );
      expect(isRetryableRefreshError("NETWORK_ERROR")).toBe(true);
    });

    it("classifies RATE_LIMITED as retryable", async () => {
      const { isRetryableRefreshError } = await import(
        "../../src/utils/errors.js"
      );
      expect(isRetryableRefreshError("RATE_LIMITED")).toBe(true);
    });

    it("classifies STORAGE_ERROR as retryable", async () => {
      const { isRetryableRefreshError } = await import(
        "../../src/utils/errors.js"
      );
      expect(isRetryableRefreshError("STORAGE_ERROR")).toBe(true);
    });

    it("classifies SESSION_REVOKED as not retryable", async () => {
      const { isRetryableRefreshError } = await import(
        "../../src/utils/errors.js"
      );
      expect(isRetryableRefreshError("SESSION_REVOKED")).toBe(false);
    });

    it("classifies INVALID_RESPONSE as not retryable", async () => {
      const { isRetryableRefreshError } = await import(
        "../../src/utils/errors.js"
      );
      expect(isRetryableRefreshError("INVALID_RESPONSE")).toBe(false);
    });

    it("classifies UNKNOWN as not retryable", async () => {
      const { isRetryableRefreshError } = await import(
        "../../src/utils/errors.js"
      );
      expect(isRetryableRefreshError("UNKNOWN")).toBe(false);
    });
  });

  describe("failure handling", () => {
    it("increments consecutiveFailures on refresh failure", async () => {
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

      // Mock the internal HTTP refresh method to fail
      vi.spyOn(
        manager as unknown as {
          refreshViaHttp: () => Promise<{ token: string; cookie: string }>;
        },
        "refreshViaHttp"
      ).mockRejectedValue(
        new RefreshError("NETWORK_ERROR", "Connection failed")
      );

      const result = await manager.refresh();

      expect(result.success).toBe(false);
      expect(manager.getState().consecutiveFailures).toBe(1);
    });

    it("resets consecutiveFailures on success", async () => {
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

      // First, make it fail to increment consecutiveFailures
      vi.spyOn(
        manager as unknown as {
          refreshViaHttp: () => Promise<{ token: string; cookie: string }>;
        },
        "refreshViaHttp"
      ).mockRejectedValueOnce(
        new RefreshError("NETWORK_ERROR", "Connection failed")
      );

      await manager.refresh();
      expect(manager.getState().consecutiveFailures).toBe(1);

      // Now make it succeed
      vi.spyOn(
        manager as unknown as {
          refreshViaHttp: () => Promise<{ token: string; cookie: string }>;
        },
        "refreshViaHttp"
      ).mockResolvedValueOnce({
        token: "xoxc-new-token",
        cookie: "xoxd-new-cookie",
      });
      vi.spyOn(manager as unknown as { validateCredentials: (token: string, cookie: string) => Promise<void> }, "validateCredentials").mockResolvedValue(undefined);

      await manager.refresh();
      expect(manager.getState().consecutiveFailures).toBe(0);
    });

    it("stores lastError on failure", async () => {
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

      vi.spyOn(
        manager as unknown as {
          refreshViaHttp: () => Promise<{ token: string; cookie: string }>;
        },
        "refreshViaHttp"
      ).mockRejectedValue(
        new RefreshError("SESSION_REVOKED", "Session has been revoked")
      );

      await manager.refresh();

      const state = manager.getState();
      expect(state.lastError).not.toBeNull();
      expect(state.lastError!.code).toBe("SESSION_REVOKED");
      expect(state.lastError!.message).toBe("Session has been revoked");
    });

    it("clears lastError on success", async () => {
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

      // First fail
      vi.spyOn(
        manager as unknown as {
          refreshViaHttp: () => Promise<{ token: string; cookie: string }>;
        },
        "refreshViaHttp"
      ).mockRejectedValueOnce(
        new RefreshError("NETWORK_ERROR", "Connection failed")
      );

      await manager.refresh();
      expect(manager.getState().lastError).not.toBeNull();

      // Then succeed
      vi.spyOn(
        manager as unknown as {
          refreshViaHttp: () => Promise<{ token: string; cookie: string }>;
        },
        "refreshViaHttp"
      ).mockResolvedValueOnce({
        token: "xoxc-new-token",
        cookie: "xoxd-new-cookie",
      });
      vi.spyOn(manager as unknown as { validateCredentials: (token: string, cookie: string) => Promise<void> }, "validateCredentials").mockResolvedValue(undefined);

      await manager.refresh();
      expect(manager.getState().lastError).toBeNull();
    });
  });

  describe("concurrent refresh guard", () => {
    it("returns REFRESH_IN_PROGRESS error when refresh is already running", async () => {
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

      // Make the first refresh take a long time
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
      const firstRefresh = manager.refresh();

      // Try to start second refresh immediately
      const secondResult = await manager.refresh();

      // Second refresh should return REFRESH_IN_PROGRESS
      expect(secondResult.success).toBe(false);
      if (!secondResult.success) {
        expect(secondResult.error.code).toBe("REFRESH_IN_PROGRESS");
      }

      // Let the first refresh complete
      resolveFirstRefresh!();
      await firstRefresh;
    });
  });
});
