import type { RefreshSchedule, RefreshResult } from "../slack/types.js";
import { createRefreshSchedule, getRefreshConfig } from "../slack/client.js";
import { RefreshManager } from "./manager.js";

/**
 * RefreshScheduler manages automatic credential refresh on a schedule.
 * Performs periodic checks and triggers refresh when due.
 */
export class RefreshScheduler {
  private schedule: RefreshSchedule;
  private manager: RefreshManager;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running: boolean = false;

  constructor() {
    this.schedule = createRefreshSchedule();
    this.manager = new RefreshManager();
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) {
      console.error("[RefreshScheduler] Scheduler is already running");
      return;
    }

    if (!this.schedule.enabled) {
      console.error(
        "[RefreshScheduler] Scheduler is disabled (bot token auth or refresh disabled)"
      );
      return;
    }

    this.running = true;

    // Set up interval for periodic checks
    this.intervalId = setInterval(() => {
      this.check();
    }, this.schedule.checkIntervalMs);

    // Update next check time
    this.schedule.nextCheckAt = new Date(
      Date.now() + this.schedule.checkIntervalMs
    );

    const config = getRefreshConfig();
    console.error(
      `[RefreshScheduler] Started. Refresh interval: ${this.schedule.intervalDays} days, ` +
        `Check interval: ${this.schedule.checkIntervalMs / 1000}s, ` +
        `Workspace: ${config.workspace}`
    );
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    console.error("[RefreshScheduler] Stopped");
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the current schedule
   */
  getSchedule(): RefreshSchedule {
    return { ...this.schedule };
  }

  /**
   * Get the refresh manager
   */
  getManager(): RefreshManager {
    return this.manager;
  }

  /**
   * Perform a scheduled check
   */
  private async check(): Promise<void> {
    // Update next check time
    this.schedule.nextCheckAt = new Date(
      Date.now() + this.schedule.checkIntervalMs
    );

    // Skip if manager is already refreshing
    if (this.manager.isInProgress()) {
      console.error("[RefreshScheduler] Skipping check - refresh in progress");
      return;
    }

    // Check if refresh is due
    if (!this.manager.isRefreshDue()) {
      return;
    }

    console.error("[RefreshScheduler] Refresh is due, triggering auto-refresh with retry");

    try {
      // Use refreshWithRetry for automatic refresh to handle transient errors
      const result = await this.manager.refreshWithRetry(false); // isManual = false

      if (result.success) {
        console.error(
          `[RefreshScheduler] Auto-refresh successful. Next refresh scheduled in ${this.schedule.intervalDays} days`
        );
      } else {
        console.error(
          `[RefreshScheduler] Auto-refresh failed: ${result.error.code} - ${result.error.message}`
        );
      }
    } catch (error) {
      console.error(
        `[RefreshScheduler] Unexpected error during auto-refresh: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Trigger a manual refresh
   * Uses refreshWithRetry for consistent retry behavior
   * @returns The result of the refresh operation
   */
  async triggerManual(): Promise<RefreshResult> {
    console.error("[RefreshScheduler] Manual refresh triggered");
    return this.manager.refreshWithRetry(true); // isManual = true
  }
}

// Singleton instance for global access
let schedulerInstance: RefreshScheduler | null = null;

/**
 * Get the global scheduler instance
 */
export function getScheduler(): RefreshScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new RefreshScheduler();
  }
  return schedulerInstance;
}

/**
 * Reset the global scheduler (mainly for testing)
 */
export function resetScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop();
    schedulerInstance = null;
  }
}
