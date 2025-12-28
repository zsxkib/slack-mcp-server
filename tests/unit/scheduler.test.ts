import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { RefreshSchedule } from "../../src/slack/types.js";

// Mock the manager module
vi.mock("../../src/refresh/manager.js", () => ({
  RefreshManager: vi.fn().mockImplementation(() => ({
    refresh: vi.fn().mockResolvedValue({ success: true }),
    refreshWithRetry: vi.fn().mockResolvedValue({ success: true }),
    isRefreshDue: vi.fn().mockReturnValue(false),
    isInProgress: vi.fn().mockReturnValue(false),
    getState: vi.fn().mockReturnValue({ status: "idle" }),
  })),
}));

// Mock the client module
vi.mock("../../src/slack/client.js", () => ({
  createRefreshSchedule: vi.fn(() => ({
    intervalDays: 7,
    checkIntervalMs: 1000, // 1 second for tests
    nextCheckAt: new Date(Date.now() + 1000),
    enabled: true,
  })),
  getRefreshConfig: vi.fn(() => ({
    credentialsPath: "/test/credentials.json",
    intervalDays: 7,
    workspace: "test-workspace",
    enabled: true,
  })),
}));

describe("RefreshScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules(); // Reset module cache to prevent stale scheduler instances
  });

  describe("start", () => {
    it("starts the scheduler and sets up interval", async () => {
      const { RefreshScheduler } = await import("../../src/refresh/scheduler.js");
      const scheduler = new RefreshScheduler();

      scheduler.start();

      expect(scheduler.isRunning()).toBe(true);
    });

    it("does not start if already running", async () => {
      const { RefreshScheduler } = await import("../../src/refresh/scheduler.js");
      const scheduler = new RefreshScheduler();

      scheduler.start();
      const firstSchedule = scheduler.getSchedule();

      scheduler.start(); // Try to start again
      const secondSchedule = scheduler.getSchedule();

      expect(firstSchedule.nextCheckAt.getTime()).toBe(
        secondSchedule.nextCheckAt.getTime()
      );
    });

    it("does not start if schedule is disabled", async () => {
      const { createRefreshSchedule } = await import("../../src/slack/client.js");

      vi.mocked(createRefreshSchedule).mockReturnValue({
        intervalDays: 7,
        checkIntervalMs: 1000,
        nextCheckAt: new Date(Date.now() + 1000),
        enabled: false, // Disabled
      });

      const { RefreshScheduler } = await import("../../src/refresh/scheduler.js");
      const scheduler = new RefreshScheduler();

      scheduler.start();

      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe("stop", () => {
    it("stops the scheduler", async () => {
      const { RefreshScheduler } = await import("../../src/refresh/scheduler.js");
      const scheduler = new RefreshScheduler();

      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe("interval checks", () => {
    it("triggers refresh when due", async () => {
      const { RefreshManager } = await import("../../src/refresh/manager.js");
      const mockRefreshWithRetry = vi.fn().mockResolvedValue({ success: true });
      const mockIsRefreshDue = vi.fn().mockReturnValue(true);

      vi.mocked(RefreshManager).mockImplementation(() => ({
        refresh: vi.fn().mockResolvedValue({ success: true }),
        refreshWithRetry: mockRefreshWithRetry,
        isRefreshDue: mockIsRefreshDue,
        isInProgress: vi.fn().mockReturnValue(false),
        getState: vi.fn().mockReturnValue({ status: "idle" }),
      }) as unknown as InstanceType<typeof RefreshManager>);

      const { RefreshScheduler } = await import("../../src/refresh/scheduler.js");
      const scheduler = new RefreshScheduler();

      scheduler.start();

      // Advance timer to trigger first check
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockIsRefreshDue).toHaveBeenCalled();
      expect(mockRefreshWithRetry).toHaveBeenCalled();
    });

    it("does not trigger refresh when not due", async () => {
      const { RefreshManager } = await import("../../src/refresh/manager.js");
      const mockRefreshWithRetry = vi.fn().mockResolvedValue({ success: true });
      const mockIsRefreshDue = vi.fn().mockReturnValue(false);

      vi.mocked(RefreshManager).mockImplementation(() => ({
        refresh: vi.fn().mockResolvedValue({ success: true }),
        refreshWithRetry: mockRefreshWithRetry,
        isRefreshDue: mockIsRefreshDue,
        isInProgress: vi.fn().mockReturnValue(false),
        getState: vi.fn().mockReturnValue({ status: "idle" }),
      }) as unknown as InstanceType<typeof RefreshManager>);

      const { RefreshScheduler } = await import("../../src/refresh/scheduler.js");
      const scheduler = new RefreshScheduler();

      scheduler.start();

      // Advance timer to trigger first check
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockIsRefreshDue).toHaveBeenCalled();
      expect(mockRefreshWithRetry).not.toHaveBeenCalled();
    });

    it("updates nextCheckAt after each check", async () => {
      const { RefreshManager } = await import("../../src/refresh/manager.js");

      // Ensure the mock has all required methods
      vi.mocked(RefreshManager).mockImplementation(() => ({
        refresh: vi.fn().mockResolvedValue({ success: true }),
        refreshWithRetry: vi.fn().mockResolvedValue({ success: true }),
        isRefreshDue: vi.fn().mockReturnValue(false),
        isInProgress: vi.fn().mockReturnValue(false),
        getState: vi.fn().mockReturnValue({ status: "idle" }),
      }) as unknown as InstanceType<typeof RefreshManager>);

      const { RefreshScheduler } = await import("../../src/refresh/scheduler.js");
      const scheduler = new RefreshScheduler();

      scheduler.start();
      const initialNextCheck = scheduler.getSchedule().nextCheckAt.getTime();

      // Advance timer past first check
      await vi.advanceTimersByTimeAsync(1100);

      const updatedNextCheck = scheduler.getSchedule().nextCheckAt.getTime();
      expect(updatedNextCheck).toBeGreaterThan(initialNextCheck);

      // Stop scheduler to prevent lingering interval callbacks
      scheduler.stop();
    });
  });

  describe("getSchedule", () => {
    it("returns current schedule", async () => {
      const { RefreshScheduler } = await import("../../src/refresh/scheduler.js");
      const scheduler = new RefreshScheduler();

      const schedule = scheduler.getSchedule();

      expect(schedule.intervalDays).toBe(7);
      expect(schedule.checkIntervalMs).toBe(1000);
      expect(schedule.enabled).toBe(true);
    });
  });

  describe("triggerManual", () => {
    it("triggers manual refresh regardless of schedule", async () => {
      const { RefreshManager } = await import("../../src/refresh/manager.js");
      const mockRefreshWithRetry = vi.fn().mockResolvedValue({
        success: true,
        credentials: {
          version: 1,
          credentials: {
            token: "xoxc-new",
            cookie: "xoxd-new",
            workspace: "test",
          },
          metadata: {
            lastRefreshed: new Date().toISOString(),
            refreshCount: 1,
            source: "manual-refresh" as const,
          },
        },
      });

      vi.mocked(RefreshManager).mockImplementation(() => ({
        refresh: vi.fn().mockResolvedValue({ success: true }),
        refreshWithRetry: mockRefreshWithRetry,
        isRefreshDue: vi.fn().mockReturnValue(false),
        isInProgress: vi.fn().mockReturnValue(false),
        getState: vi.fn().mockReturnValue({ status: "idle" }),
      }) as unknown as InstanceType<typeof RefreshManager>);

      const { RefreshScheduler } = await import("../../src/refresh/scheduler.js");
      const scheduler = new RefreshScheduler();

      const result = await scheduler.triggerManual();

      expect(mockRefreshWithRetry).toHaveBeenCalledWith(true); // isManual = true
      expect(result.success).toBe(true);
    });
  });
});
