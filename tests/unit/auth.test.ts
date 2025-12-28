import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveAuthConfig,
  getAuthType,
  isSearchAvailable,
  resetSlackClient,
  updateClientCredentials,
  getSlackClient,
  getRefreshConfig,
  isRefreshAvailable,
} from "../../src/slack/client.js";
import { AUTH_ERRORS, maskCredential } from "../../src/utils/errors.js";

describe("resolveAuthConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Clear any auth-related env vars
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_USER_TOKEN;
    delete process.env.SLACK_COOKIE_D;
    resetSlackClient();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // T004: resolveAuthConfig returns UserAuthConfig when SLACK_USER_TOKEN and SLACK_COOKIE_D are set
  it("returns UserAuthConfig when SLACK_USER_TOKEN and SLACK_COOKIE_D are set", () => {
    process.env.SLACK_USER_TOKEN = "xoxc-user-token-123";
    process.env.SLACK_COOKIE_D = "xoxd-cookie-value-456";

    const config = resolveAuthConfig();

    expect(config.type).toBe("user");
    expect(config.token).toBe("xoxc-user-token-123");
    if (config.type === "user") {
      expect(config.cookie).toBe("xoxd-cookie-value-456");
    }
  });

  // T005: resolveAuthConfig throws error when SLACK_USER_TOKEN is set without SLACK_COOKIE_D
  it("throws error when SLACK_USER_TOKEN is set without SLACK_COOKIE_D", () => {
    process.env.SLACK_USER_TOKEN = "xoxc-user-token-123";

    expect(() => resolveAuthConfig()).toThrow(AUTH_ERRORS.MISSING_COOKIE);
  });

  // T006: resolveAuthConfig validates xoxc- prefix for user token
  it("validates xoxc- prefix for user token", () => {
    process.env.SLACK_USER_TOKEN = "invalid-token";
    process.env.SLACK_COOKIE_D = "xoxd-cookie-value";

    expect(() => resolveAuthConfig()).toThrow("xoxc-");
  });

  // T011: resolveAuthConfig returns BotAuthConfig when only SLACK_BOT_TOKEN is set
  it("returns BotAuthConfig when only SLACK_BOT_TOKEN is set", () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-bot-token-123";

    const config = resolveAuthConfig();

    expect(config.type).toBe("bot");
    expect(config.token).toBe("xoxb-bot-token-123");
  });

  // T012: resolveAuthConfig returns BotAuthConfig when both bot and user credentials are set (backward compatibility)
  it("returns BotAuthConfig when both bot and user credentials are set (backward compatibility)", () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-bot-token-123";
    process.env.SLACK_USER_TOKEN = "xoxc-user-token-456";
    process.env.SLACK_COOKIE_D = "xoxd-cookie-value";

    const config = resolveAuthConfig();

    expect(config.type).toBe("bot");
    expect(config.token).toBe("xoxb-bot-token-123");
  });

  // T013: resolveAuthConfig throws error when no credentials are configured
  it("throws error when no credentials are configured", () => {
    expect(() => resolveAuthConfig()).toThrow(AUTH_ERRORS.NO_AUTH_CONFIGURED);
  });
});

describe("getAuthType", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_USER_TOKEN;
    delete process.env.SLACK_COOKIE_D;
    resetSlackClient();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // T014 (partial): getAuthType returns correct type based on resolved config - user auth case
  it("returns 'user' when user token auth is configured", () => {
    process.env.SLACK_USER_TOKEN = "xoxc-user-token-123";
    process.env.SLACK_COOKIE_D = "xoxd-cookie-value-456";

    expect(getAuthType()).toBe("user");
  });

  // T014: getAuthType returns 'bot' when bot token auth is configured
  it("returns 'bot' when bot token auth is configured", () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-bot-token-123";

    expect(getAuthType()).toBe("bot");
  });
});

describe("isSearchAvailable", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_USER_TOKEN;
    delete process.env.SLACK_COOKIE_D;
    resetSlackClient();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // T018: isSearchAvailable returns true when user auth is configured
  it("returns true when user auth is configured", () => {
    process.env.SLACK_USER_TOKEN = "xoxc-user-token-123";
    process.env.SLACK_COOKIE_D = "xoxd-cookie-value-456";

    expect(isSearchAvailable()).toBe(true);
  });

  // T019: isSearchAvailable returns false when bot auth is configured
  it("returns false when bot auth is configured", () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-bot-token-123";

    expect(isSearchAvailable()).toBe(false);
  });
});

describe("maskCredential", () => {
  // T024: maskCredential correctly masks short credentials
  it("correctly masks short credentials (8 chars or less)", () => {
    expect(maskCredential("abcd")).toBe("***");
    expect(maskCredential("12345678")).toBe("***");
    expect(maskCredential("")).toBe("***");
  });

  // T025: maskCredential correctly masks long credentials
  it("correctly masks long credentials (shows first 4 and last 4 chars)", () => {
    // "xoxc-123456789" → "xoxc***6789"
    expect(maskCredential("xoxc-123456789")).toBe("xoxc***6789");
    expect(maskCredential("xoxb-abcdefghij")).toBe("xoxb***ghij");
    expect(maskCredential("123456789")).toBe("1234***6789");
  });
});

describe("updateClientCredentials", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_USER_TOKEN;
    delete process.env.SLACK_COOKIE_D;
    resetSlackClient();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("updates cached auth config with new credentials", () => {
    // Set initial credentials via environment
    process.env.SLACK_USER_TOKEN = "xoxc-initial-token";
    process.env.SLACK_COOKIE_D = "xoxd-initial-cookie";

    // Verify initial config
    const initialConfig = resolveAuthConfig();
    expect(initialConfig.type).toBe("user");
    expect(initialConfig.token).toBe("xoxc-initial-token");
    if (initialConfig.type === "user") {
      expect(initialConfig.cookie).toBe("xoxd-initial-cookie");
    }

    // Update credentials
    updateClientCredentials("xoxc-new-token", "xoxd-new-cookie");

    // Verify updated config - should return new credentials from cache
    const updatedConfig = resolveAuthConfig();
    expect(updatedConfig.type).toBe("user");
    expect(updatedConfig.token).toBe("xoxc-new-token");
    if (updatedConfig.type === "user") {
      expect(updatedConfig.cookie).toBe("xoxd-new-cookie");
    }
  });

  it("updates slack client with new credentials after refresh", () => {
    // Set initial credentials via environment
    process.env.SLACK_USER_TOKEN = "xoxc-initial-token";
    process.env.SLACK_COOKIE_D = "xoxd-initial-cookie";

    // Get initial client
    const initialClient = getSlackClient();
    expect(initialClient).toBeDefined();

    // Update credentials
    updateClientCredentials("xoxc-new-token", "xoxd-new-cookie");

    // Get client again - should return a different instance with new credentials
    const updatedClient = getSlackClient();
    expect(updatedClient).toBeDefined();

    // The client instance should be different after update
    expect(updatedClient).not.toBe(initialClient);

    // Verify the cached config has the new credentials
    const config = resolveAuthConfig();
    expect(config.token).toBe("xoxc-new-token");
    if (config.type === "user") {
      expect(config.cookie).toBe("xoxd-new-cookie");
    }
  });

  it("allows subsequent getSlackClient calls to return the updated client", () => {
    // Set initial credentials
    process.env.SLACK_USER_TOKEN = "xoxc-initial-token";
    process.env.SLACK_COOKIE_D = "xoxd-initial-cookie";

    // Update credentials
    updateClientCredentials("xoxc-updated-token", "xoxd-updated-cookie");

    // Multiple calls should return the same updated client instance
    const client1 = getSlackClient();
    const client2 = getSlackClient();
    const client3 = getSlackClient();

    expect(client1).toBe(client2);
    expect(client2).toBe(client3);

    // All should reflect the updated credentials
    const config = resolveAuthConfig();
    expect(config.token).toBe("xoxc-updated-token");
  });
});

describe("getRefreshConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.SLACK_CREDENTIALS_PATH;
    delete process.env.SLACK_REFRESH_INTERVAL_DAYS;
    delete process.env.SLACK_WORKSPACE;
    delete process.env.SLACK_REFRESH_ENABLED;
    resetSlackClient();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns default values when no environment variables are set", () => {
    const config = getRefreshConfig();

    expect(config.intervalDays).toBe(7);
    expect(config.workspace).toBeNull();
    expect(config.enabled).toBe(true);
    expect(config.credentialsPath).toContain("credentials.json");
  });

  it("parses SLACK_CREDENTIALS_PATH correctly", () => {
    process.env.SLACK_CREDENTIALS_PATH = "/custom/path/creds.json";

    const config = getRefreshConfig();

    expect(config.credentialsPath).toBe("/custom/path/creds.json");
  });

  it("parses SLACK_REFRESH_INTERVAL_DAYS correctly", () => {
    process.env.SLACK_REFRESH_INTERVAL_DAYS = "14";

    const config = getRefreshConfig();

    expect(config.intervalDays).toBe(14);
  });

  it("handles invalid SLACK_REFRESH_INTERVAL_DAYS gracefully", () => {
    process.env.SLACK_REFRESH_INTERVAL_DAYS = "not-a-number";

    const config = getRefreshConfig();

    expect(config.intervalDays).toBe(7); // Falls back to default
  });

  it("parses SLACK_WORKSPACE correctly", () => {
    process.env.SLACK_WORKSPACE = "my-company";

    const config = getRefreshConfig();

    expect(config.workspace).toBe("my-company");
  });

  it("parses SLACK_REFRESH_ENABLED=false correctly", () => {
    process.env.SLACK_REFRESH_ENABLED = "false";

    const config = getRefreshConfig();

    expect(config.enabled).toBe(false);
  });

  it("parses SLACK_REFRESH_ENABLED=true correctly", () => {
    process.env.SLACK_REFRESH_ENABLED = "true";

    const config = getRefreshConfig();

    expect(config.enabled).toBe(true);
  });
});

describe("isRefreshAvailable", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_USER_TOKEN;
    delete process.env.SLACK_COOKIE_D;
    delete process.env.SLACK_WORKSPACE;
    delete process.env.SLACK_REFRESH_ENABLED;
    resetSlackClient();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns false for bot token auth", () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-bot-token";

    expect(isRefreshAvailable()).toBe(false);
  });

  it("returns false when workspace is not set", () => {
    process.env.SLACK_USER_TOKEN = "xoxc-user-token";
    process.env.SLACK_COOKIE_D = "xoxd-cookie";

    expect(isRefreshAvailable()).toBe(false);
  });

  it("returns true when user auth and workspace are configured", () => {
    process.env.SLACK_USER_TOKEN = "xoxc-user-token";
    process.env.SLACK_COOKIE_D = "xoxd-cookie";
    process.env.SLACK_WORKSPACE = "my-company";

    expect(isRefreshAvailable()).toBe(true);
  });

  it("returns false when refresh is explicitly disabled", () => {
    process.env.SLACK_USER_TOKEN = "xoxc-user-token";
    process.env.SLACK_COOKIE_D = "xoxd-cookie";
    process.env.SLACK_WORKSPACE = "my-company";
    process.env.SLACK_REFRESH_ENABLED = "false";

    expect(isRefreshAvailable()).toBe(false);
  });
});
