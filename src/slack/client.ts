import { WebClient } from "@slack/web-api";
import type { AuthConfig, AuthType, RefreshSchedule } from "./types.js";
import { AUTH_ERRORS } from "../utils/errors.js";

let slackClient: WebClient | null = null;
let cachedAuthConfig: AuthConfig | null = null;
let cachedRefreshConfig: RefreshConfig | null = null;

/**
 * Configuration for credential refresh
 */
export interface RefreshConfig {
  /** Path to credential storage file */
  credentialsPath: string;
  /** Days between automatic refreshes */
  intervalDays: number;
  /** Workspace name for refresh requests */
  workspace: string | null;
  /** Whether refresh is enabled */
  enabled: boolean;
}

/** Default refresh interval in days */
const DEFAULT_REFRESH_INTERVAL_DAYS = 7;

/** Default check interval in milliseconds (1 hour) */
const DEFAULT_CHECK_INTERVAL_MS = 3600000;

/**
 * Resolves authentication configuration from environment variables.
 *
 * Priority:
 * 1. SLACK_BOT_TOKEN (if set, use bot auth for backward compatibility)
 * 2. SLACK_USER_TOKEN + SLACK_COOKIE_D (if both set, use user auth)
 * 3. Error if neither is configured
 */
export function resolveAuthConfig(): AuthConfig {
  if (cachedAuthConfig) {
    return cachedAuthConfig;
  }

  const botToken = process.env.SLACK_BOT_TOKEN;
  const userToken = process.env.SLACK_USER_TOKEN;
  const cookie = process.env.SLACK_COOKIE_D;

  // Bot token authentication (priority for backward compatibility)
  if (botToken) {
    cachedAuthConfig = {
      type: "bot",
      token: botToken,
    };
    return cachedAuthConfig;
  }

  // User token authentication
  if (userToken) {
    // Validate xoxc- prefix
    if (!userToken.startsWith("xoxc-")) {
      throw new Error(
        "User token must start with 'xoxc-'. " +
          "Please provide a valid Slack user session token."
      );
    }

    // Cookie is required for user token
    if (!cookie) {
      throw new Error(AUTH_ERRORS.MISSING_COOKIE);
    }

    cachedAuthConfig = {
      type: "user",
      token: userToken,
      cookie,
    };
    return cachedAuthConfig;
  }

  // No valid configuration found
  throw new Error(AUTH_ERRORS.NO_AUTH_CONFIGURED);
}

/**
 * Returns the current authentication type.
 */
export function getAuthType(): AuthType {
  const config = resolveAuthConfig();
  return config.type;
}

/**
 * Checks if search functionality is available.
 * Search requires user token authentication.
 */
export function isSearchAvailable(): boolean {
  return getAuthType() === "user";
}

export function getSlackClient(): WebClient {
  if (!slackClient) {
    const config = resolveAuthConfig();

    if (config.type === "user") {
      // User token auth: include Cookie header
      slackClient = new WebClient(config.token, {
        headers: {
          Cookie: `d=${config.cookie}`,
        },
      });
    } else {
      // Bot token auth (to be implemented in US3)
      slackClient = new WebClient(config.token);
    }
  }
  return slackClient;
}

export function resetSlackClient(): void {
  slackClient = null;
  cachedAuthConfig = null;
  cachedRefreshConfig = null;
}

/**
 * Get refresh configuration from environment variables
 */
export function getRefreshConfig(): RefreshConfig {
  if (cachedRefreshConfig) {
    return cachedRefreshConfig;
  }

  const credentialsPath =
    process.env.SLACK_CREDENTIALS_PATH ??
    `${process.env.HOME ?? "~"}/.slack-mcp-server/credentials.json`;

  const intervalDaysStr = process.env.SLACK_REFRESH_INTERVAL_DAYS;
  const intervalDays = intervalDaysStr
    ? parseInt(intervalDaysStr, 10)
    : DEFAULT_REFRESH_INTERVAL_DAYS;

  const workspace = process.env.SLACK_WORKSPACE ?? null;

  const enabledStr = process.env.SLACK_REFRESH_ENABLED;
  // Enabled by default for user auth, unless explicitly set to false
  const enabled = enabledStr !== "false";

  cachedRefreshConfig = {
    credentialsPath,
    intervalDays: isNaN(intervalDays) ? DEFAULT_REFRESH_INTERVAL_DAYS : intervalDays,
    workspace,
    enabled,
  };

  return cachedRefreshConfig;
}

/**
 * Check if refresh functionality is available
 * Refresh requires user token authentication and workspace to be set
 */
export function isRefreshAvailable(): boolean {
  const authType = getAuthType();
  if (authType !== "user") {
    return false;
  }

  const config = getRefreshConfig();
  return config.enabled && config.workspace !== null;
}

/**
 * Create a refresh schedule based on current configuration
 */
export function createRefreshSchedule(): RefreshSchedule {
  const config = getRefreshConfig();
  const authType = getAuthType();

  return {
    intervalDays: config.intervalDays,
    checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
    nextCheckAt: new Date(Date.now() + DEFAULT_CHECK_INTERVAL_MS),
    enabled: authType === "user" && config.enabled && config.workspace !== null,
  };
}

/**
 * Update the Slack client with new credentials
 * Called after a successful credential refresh
 */
export function updateClientCredentials(token: string, cookie: string): void {
  // Reset the client to force re-creation with new credentials
  slackClient = null;

  // Update the cached auth config
  cachedAuthConfig = {
    type: "user",
    token,
    cookie,
  };

  // Create new client with updated credentials
  slackClient = new WebClient(token, {
    headers: {
      Cookie: `d=${cookie}`,
    },
  });
}

/**
 * Initialize credentials from persisted storage if available
 * Called on startup to use the most recent credentials
 * @returns true if credentials were loaded from storage, false otherwise
 */
export async function initializeFromStorage(): Promise<boolean> {
  const authType = getAuthType();
  if (authType !== "user") {
    // Bot token auth doesn't use persisted credentials
    return false;
  }

  const config = getRefreshConfig();
  if (!config.enabled || !config.workspace) {
    // Refresh not configured, use environment credentials
    return false;
  }

  try {
    // Dynamic import to avoid circular dependency
    const { credentialsExist, loadCredentials } = await import(
      "../refresh/storage.js"
    );

    if (!credentialsExist()) {
      // No persisted credentials, use environment credentials
      // But we should save the initial credentials for future use
      const envConfig = resolveAuthConfig();
      if (envConfig.type === "user") {
        const { saveCredentials, createInitialCredentials } = await import(
          "../refresh/storage.js"
        );
        const initialCredentials = createInitialCredentials(
          envConfig.token,
          envConfig.cookie,
          config.workspace
        );
        saveCredentials(initialCredentials);
        console.log("[Client] Initial credentials saved to storage");
      }
      return false;
    }

    // Load persisted credentials
    const stored = loadCredentials();

    // Update the client with persisted credentials
    updateClientCredentials(
      stored.credentials.token,
      stored.credentials.cookie
    );

    console.log(
      `[Client] Loaded credentials from storage. Last refreshed: ${stored.metadata.lastRefreshed}`
    );
    return true;
  } catch (error) {
    console.error(
      `[Client] Failed to load credentials from storage: ${error instanceof Error ? error.message : String(error)}`
    );
    // Fall back to environment credentials
    return false;
  }
}
