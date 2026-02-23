// Authentication types

/**
 * Authentication method type
 */
export type AuthType = "bot" | "user";

/**
 * Bot token authentication configuration
 */
export interface BotAuthConfig {
  type: "bot";
  /** Slack Bot User OAuth Token (xoxb-*) */
  token: string;
}

/**
 * User token authentication configuration
 */
export interface UserAuthConfig {
  type: "user";
  /** Slack user session token (xoxc-*) */
  token: string;
  /** Slack "d" cookie value */
  cookie: string;
}

/**
 * Union type for all authentication configurations
 */
export type AuthConfig = BotAuthConfig | UserAuthConfig;

// Core entity types - read-only projections of Slack API responses

export interface Channel {
  id: string;
  name: string;
  topic: string | null;
  purpose: string | null;
  memberCount: number;
  isArchived: boolean;
  created: number;
}

export interface Reaction {
  name: string;
  count: number;
  users: string[];
}

export interface Message {
  ts: string;
  userId: string;
  text: string;
  threadTs: string | null;
  replyCount: number | null;
  reactions: Reaction[];
}

export interface User {
  id: string;
  name: string;
  realName: string | null;
  displayName: string | null;
  isBot: boolean;
  isAdmin: boolean;
  deleted: boolean;
}

export interface UserProfile {
  displayName: string;
  realName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  statusText: string | null;
  statusEmoji: string | null;
  image72: string | null;
}

/**
 * LLM-friendly formatted message — produced by the formatting pipeline.
 * Separates human-readable time from machine IDs for clean output.
 */
export interface FormattedMessage {
  id: string;
  time: string;
  user: string;
  text: string;
  threadId?: string;
  replyCount?: number;
  reactions?: Record<string, number>;
}

/**
 * LLM-friendly formatted search result.
 * Combines redundant fields: channel = "#name (ID)", separates IDs from display.
 */
export interface FormattedSearchResult {
  id: string;
  channel: string;
  user: string;
  time: string;
  text: string;
  threadId?: string;
  threadParent?: {
    user: string;
    time: string;
    text: string;
  };
}

// Pagination types

export interface CursorPaginationResult<T> {
  items: T[];
  nextCursor: string | null;
}

// Error types

export type SlackErrorCode =
  | "rate_limited"
  | "invalid_auth"
  | "missing_scope"
  | "channel_not_found"
  | "user_not_found"
  | "not_in_channel"
  | "thread_not_found";

export interface SlackMcpError {
  code: string;
  message: string;
  retryable: boolean;
  retryAfter?: number;
}

// Refresh-related types

/**
 * Error codes for credential refresh operations
 */
export type RefreshErrorCode =
  | "NETWORK_ERROR" // Transient network issue
  | "RATE_LIMITED" // Slack rate limit (429)
  | "SESSION_REVOKED" // Credentials no longer valid
  | "INVALID_RESPONSE" // Unexpected response format
  | "STORAGE_ERROR" // Failed to persist credentials
  | "REFRESH_IN_PROGRESS" // Another refresh already running
  | "REFRESH_NOT_AVAILABLE" // Bot token auth, refresh not applicable
  | "UNKNOWN"; // Unexpected error

/**
 * Status of refresh operations
 */
export type RefreshStatus = "idle" | "in_progress" | "succeeded" | "failed";

/**
 * Details about a refresh failure
 */
export interface RefreshError {
  code: RefreshErrorCode;
  message: string;
  timestamp: Date;
  attempt: number;
  retryable: boolean;
}

/**
 * Tracks the current status of refresh operations (in-memory only)
 */
export interface RefreshState {
  status: RefreshStatus;
  lastAttempt: Date | null;
  lastSuccess: Date | null;
  lastError: RefreshError | null;
  consecutiveFailures: number;
  isManualTrigger: boolean;
}

/**
 * Configuration and timing for automatic refresh
 */
export interface RefreshSchedule {
  intervalDays: number;
  checkIntervalMs: number;
  nextCheckAt: Date;
  enabled: boolean;
}

/**
 * Persisted credentials in JSON file
 */
export interface StoredCredentials {
  version: 1;
  credentials: {
    token: string; // xoxc-prefixed user token
    cookie: string; // xoxd-prefixed d cookie
    workspace: string; // Workspace identifier
  };
  metadata: {
    lastRefreshed: string; // ISO 8601 timestamp
    refreshCount: number;
    source: "initial" | "auto-refresh" | "manual-refresh";
  };
}

/**
 * Result of a refresh operation
 */
export type RefreshResult =
  | { success: true; credentials: StoredCredentials }
  | { success: false; error: RefreshError };
