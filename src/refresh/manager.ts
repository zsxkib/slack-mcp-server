import type {
  RefreshState,
  RefreshResult,
  StoredCredentials,
  RefreshError as RefreshErrorType,
} from "../slack/types.js";
import { RefreshError, isRetryableRefreshError } from "../utils/errors.js";
import { logError } from "../utils/error-log.js";
import {
  loadCredentials,
  saveCredentials,
  credentialsExist,
} from "./storage.js";
import {
  getRefreshConfig,
  updateClientCredentials,
} from "../slack/client.js";

/** Retry configuration */
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  multiplier: 2,
  jitterFactor: 0.25, // +/- 25%
};

/**
 * RefreshManager orchestrates the credential refresh lifecycle.
 * Handles HTTP requests to Slack workspace, credential validation,
 * and state management.
 */
export class RefreshManager {
  private state: RefreshState;

  constructor() {
    this.state = {
      status: "idle",
      lastAttempt: null,
      lastSuccess: null,
      lastError: null,
      consecutiveFailures: 0,
      isManualTrigger: false,
    };
  }

  /**
   * Get the current refresh state
   */
  getState(): RefreshState {
    return { ...this.state };
  }

  /**
   * Check if a refresh is currently in progress
   */
  isInProgress(): boolean {
    return this.state.status === "in_progress";
  }

  /**
   * Check if refresh is due based on last refresh time and configured interval
   */
  isRefreshDue(): boolean {
    if (!credentialsExist()) {
      return false;
    }

    try {
      const credentials = loadCredentials();
      const config = getRefreshConfig();
      const lastRefreshed = new Date(credentials.metadata.lastRefreshed);
      const intervalMs = config.intervalDays * 24 * 60 * 60 * 1000;
      const nextRefreshDue = new Date(lastRefreshed.getTime() + intervalMs);

      return Date.now() >= nextRefreshDue.getTime();
    } catch {
      // If we can't load credentials, refresh is not due
      return false;
    }
  }

  /**
   * Perform a credential refresh
   * @param isManual - Whether this is a manual (true) or automatic (false) refresh
   */
  async refresh(isManual: boolean = false): Promise<RefreshResult> {
    // Check if already in progress
    if (this.state.status === "in_progress") {
      const error: RefreshErrorType = {
        code: "REFRESH_IN_PROGRESS",
        message: "A credential refresh is already in progress. Please wait for it to complete.",
        timestamp: new Date(),
        attempt: 0,
        retryable: true,
      };
      return { success: false, error };
    }

    // Update state to in_progress
    this.state = {
      ...this.state,
      status: "in_progress",
      lastAttempt: new Date(),
      isManualTrigger: isManual,
    };

    try {
      // Load current credentials
      const currentCredentials = loadCredentials();

      // Perform HTTP refresh to get new credentials
      const newCreds = await this.refreshViaHttp(currentCredentials);

      // Validate new credentials with Slack API
      await this.validateCredentials(newCreds.token, newCreds.cookie);

      // Create updated stored credentials
      const updatedCredentials: StoredCredentials = {
        version: 1,
        credentials: {
          token: newCreds.token,
          cookie: newCreds.cookie,
          workspace: currentCredentials.credentials.workspace,
        },
        metadata: {
          lastRefreshed: new Date().toISOString(),
          refreshCount: currentCredentials.metadata.refreshCount + 1,
          source: isManual ? "manual-refresh" : "auto-refresh",
        },
      };

      // Save to storage
      saveCredentials(updatedCredentials);

      // Update the Slack client with new credentials
      updateClientCredentials(newCreds.token, newCreds.cookie);

      // Update state to succeeded
      this.state = {
        ...this.state,
        status: "idle",
        lastSuccess: new Date(),
        lastError: null,
        consecutiveFailures: 0,
        isManualTrigger: false,
      };

      console.error(
        `[RefreshManager] Credential refresh successful (${isManual ? "manual" : "auto"}). ` +
          `Total refreshes: ${updatedCredentials.metadata.refreshCount}`
      );

      return { success: true, credentials: updatedCredentials };
    } catch (error) {
      const refreshError = this.mapToRefreshError(error);

      // Update state to failed
      this.state = {
        ...this.state,
        status: "idle",
        lastError: refreshError,
        consecutiveFailures: this.state.consecutiveFailures + 1,
        isManualTrigger: false,
      };

      console.error(
        `[RefreshManager] Credential refresh failed: ${refreshError.code} - ${refreshError.message}`
      );
      logError({
        level: "error",
        component: "RefreshManager",
        code: refreshError.code,
        message: refreshError.message,
        attempt: refreshError.attempt,
        retryable: refreshError.retryable,
      });

      return { success: false, error: refreshError };
    }
  }

  /**
   * Perform HTTP request to Slack workspace to refresh credentials
   */
  private async refreshViaHttp(
    currentCredentials: StoredCredentials
  ): Promise<{ token: string; cookie: string }> {
    const workspace = currentCredentials.credentials.workspace;
    const url = `https://${workspace}.slack.com`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Cookie: `d=${currentCredentials.credentials.cookie}`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new RefreshError("RATE_LIMITED", "Rate limited by Slack");
        }
        if (response.status === 401 || response.status === 403) {
          throw new RefreshError(
            "SESSION_REVOKED",
            "Slack session has been revoked. Please re-authenticate and update credentials."
          );
        }
        throw new RefreshError(
          "NETWORK_ERROR",
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      // Extract response body first to check for session status
      const body = await response.text();

      // Check if we got redirected to login/signin page (session revoked)
      const finalUrl = response.url;
      if (finalUrl.includes("/signin") || finalUrl.includes("/sign_in") || finalUrl.includes("/?redir=")) {
        throw new RefreshError(
          "SESSION_REVOKED",
          "Slack session has expired. Redirected to sign-in page. Please re-authenticate."
        );
      }

      // Check body for signs of unauthenticated response
      if (body.includes('action="/signin"') || body.includes('action="/sign_in"') ||
          body.includes("You need to sign in") || body.includes("Sign in to Slack")) {
        throw new RefreshError(
          "SESSION_REVOKED",
          "Slack session has expired. Please re-authenticate and update credentials."
        );
      }

      // Extract new d cookie from Set-Cookie header
      const setCookie = response.headers.get("set-cookie");
      const newCookie = this.extractDCookie(setCookie);

      // Extract api_token from response body
      const newToken = this.extractApiToken(body);

      // If no new cookie but we have a token, the session is still valid
      // The d cookie sliding expiration may not always return a new cookie on every request
      // In this case, we can reuse the current cookie
      const effectiveCookie = newCookie ?? currentCredentials.credentials.cookie;

      if (!newToken) {
        // No token found - might be a different page or session issue
        throw new RefreshError(
          "INVALID_RESPONSE",
          "No api_token found in response body. The session may be invalid or the page format has changed."
        );
      }

      return { token: newToken, cookie: effectiveCookie };
    } catch (error) {
      if (error instanceof RefreshError) {
        throw error;
      }
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new RefreshError("NETWORK_ERROR", `Network error: ${error.message}`);
      }
      throw new RefreshError(
        "UNKNOWN",
        `Unexpected error during refresh: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Extract d cookie value from Set-Cookie header
   */
  private extractDCookie(setCookie: string | null): string | null {
    if (!setCookie) {
      return null;
    }

    // Handle multiple Set-Cookie headers (comma-separated or multiple headers)
    const cookies = setCookie.split(/,(?=\s*\w+=)/);

    for (const cookie of cookies) {
      // Look for d= cookie
      const match = cookie.match(/(?:^|;\s*)d=([^;]+)/);
      if (match && match[1]) {
        const value = match[1].trim();
        // Ensure it has xoxd- prefix
        if (value.startsWith("xoxd-")) {
          return value;
        }
      }
    }

    return null;
  }

  /**
   * Extract api_token from response body
   * The token is embedded in the HTML/JSON response
   */
  private extractApiToken(body: string): string | null {
    // Try JSON format first: "api_token":"xoxc-..."
    let match = body.match(/"api_token"\s*:\s*"(xoxc-[^"]+)"/);
    if (match && match[1]) {
      return match[1];
    }

    // Try alternative format: api_token: 'xoxc-...'
    match = body.match(/api_token\s*:\s*['"]?(xoxc-[^'"}\s,]+)/);
    if (match && match[1]) {
      return match[1];
    }

    return null;
  }

  /**
   * Validate refreshed credentials using Slack's auth.test API
   */
  private async validateCredentials(
    token: string,
    cookie: string
  ): Promise<void> {
    try {
      // Create a temporary client with new credentials
      const { WebClient } = await import("@slack/web-api");
      const tempClient = new WebClient(token, {
        headers: {
          Cookie: `d=${cookie}`,
        },
      });

      const result = await tempClient.auth.test();

      if (!result.ok) {
        throw new RefreshError(
          "INVALID_RESPONSE",
          `Credential validation failed: ${result.error ?? "unknown error"}`
        );
      }

      console.error(
        `[RefreshManager] Credentials validated for user: ${result.user_id}`
      );
    } catch (error) {
      if (error instanceof RefreshError) {
        throw error;
      }

      // Check for auth errors from Slack API
      if (error instanceof Error && "code" in error) {
        const slackError = error as Error & { data?: { error?: string } };
        const errorCode = slackError.data?.error ?? "unknown";

        if (errorCode === "invalid_auth" || errorCode === "account_inactive") {
          throw new RefreshError(
            "SESSION_REVOKED",
            "Refreshed credentials are invalid. Session may have been revoked."
          );
        }
      }

      throw new RefreshError(
        "INVALID_RESPONSE",
        `Failed to validate credentials: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Map various errors to RefreshError type
   */
  private mapToRefreshError(error: unknown, attempt: number = 1): RefreshErrorType {
    if (error instanceof RefreshError) {
      return {
        ...error.toJSON(),
        attempt,
      };
    }

    return {
      code: "UNKNOWN",
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date(),
      attempt,
      retryable: false,
    };
  }

  /**
   * Perform refresh with retry logic using exponential backoff
   * @param isManual - Whether this is a manual (true) or automatic (false) refresh
   */
  async refreshWithRetry(isManual: boolean = false): Promise<RefreshResult> {
    // Check if already in progress
    if (this.state.status === "in_progress") {
      const error: RefreshErrorType = {
        code: "REFRESH_IN_PROGRESS",
        message: "A credential refresh is already in progress. Please wait for it to complete.",
        timestamp: new Date(),
        attempt: 0,
        retryable: true,
      };
      return { success: false, error };
    }

    // Update state to in_progress
    this.state = {
      ...this.state,
      status: "in_progress",
      lastAttempt: new Date(),
      isManualTrigger: isManual,
    };

    let lastError: RefreshErrorType | null = null;

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
      try {
        // Load current credentials
        const currentCredentials = loadCredentials();

        // Perform HTTP refresh to get new credentials
        const newCreds = await this.refreshViaHttp(currentCredentials);

        // Validate new credentials with Slack API
        await this.validateCredentials(newCreds.token, newCreds.cookie);

        // Create updated stored credentials
        const updatedCredentials: StoredCredentials = {
          version: 1,
          credentials: {
            token: newCreds.token,
            cookie: newCreds.cookie,
            workspace: currentCredentials.credentials.workspace,
          },
          metadata: {
            lastRefreshed: new Date().toISOString(),
            refreshCount: currentCredentials.metadata.refreshCount + 1,
            source: isManual ? "manual-refresh" : "auto-refresh",
          },
        };

        // Save to storage
        saveCredentials(updatedCredentials);

        // Update the Slack client with new credentials
        updateClientCredentials(newCreds.token, newCreds.cookie);

        // Update state to succeeded
        this.state = {
          ...this.state,
          status: "idle",
          lastSuccess: new Date(),
          lastError: null,
          consecutiveFailures: 0,
          isManualTrigger: false,
        };

        console.error(
          `[RefreshManager] Credential refresh successful (${isManual ? "manual" : "auto"}, ` +
            `attempt ${attempt}/${RETRY_CONFIG.maxAttempts}). ` +
            `Total refreshes: ${updatedCredentials.metadata.refreshCount}`
        );

        return { success: true, credentials: updatedCredentials };
      } catch (error) {
        lastError = this.mapToRefreshError(error, attempt);

        // Log the failure
        console.warn(
          `[RefreshManager] Refresh attempt ${attempt}/${RETRY_CONFIG.maxAttempts} failed: ` +
            `${lastError.code} - ${lastError.message}`
        );
        logError({
          level: "warn",
          component: "RefreshManager",
          code: lastError.code,
          message: lastError.message,
          attempt: lastError.attempt,
          retryable: lastError.retryable,
        });

        // Check if error is retryable and we have attempts left
        if (!isRetryableRefreshError(lastError.code) || attempt >= RETRY_CONFIG.maxAttempts) {
          // Don't retry - either non-retryable error or max attempts reached
          break;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateBackoffDelay(attempt);
        console.error(
          `[RefreshManager] Retrying in ${Math.round(delay / 1000)}s...`
        );

        await this.sleep(delay);
      }
    }

    // All retries exhausted or non-retryable error
    this.state = {
      ...this.state,
      status: "idle",
      lastError: lastError!,
      consecutiveFailures: this.state.consecutiveFailures + 1,
      isManualTrigger: false,
    };

    // Log session revoked with guidance
    if (lastError!.code === "SESSION_REVOKED") {
      console.error(
        "[RefreshManager] SESSION_REVOKED: Your Slack session has been invalidated. " +
          "To resolve:\n" +
          "  1. Log into Slack via browser\n" +
          "  2. Extract new xoxc token and d cookie\n" +
          "  3. Update SLACK_USER_TOKEN and SLACK_COOKIE_D environment variables\n" +
          "  4. Restart the MCP server"
      );
    } else {
      console.error(
        `[RefreshManager] Credential refresh failed after ${RETRY_CONFIG.maxAttempts} attempts: ` +
          `${lastError!.code} - ${lastError!.message}`
      );
    }

    // Graceful degradation: continue with existing credentials
    console.warn(
      "[RefreshManager] Continuing with existing credentials. " +
        "They will remain valid until the session expires."
    );

    return { success: false, error: lastError! };
  }

  /**
   * Calculate backoff delay with jitter
   */
  private calculateBackoffDelay(attempt: number): number {
    // Exponential backoff: baseDelay * multiplier^(attempt-1)
    const exponentialDelay =
      RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.multiplier, attempt - 1);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, RETRY_CONFIG.maxDelayMs);

    // Apply jitter: +/- jitterFactor
    const jitterRange = cappedDelay * RETRY_CONFIG.jitterFactor;
    const jitter = (Math.random() * 2 - 1) * jitterRange;

    return Math.round(cappedDelay + jitter);
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
