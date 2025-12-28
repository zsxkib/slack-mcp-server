import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getSlackClient,
  resetSlackClient,
  updateClientCredentials,
  resolveAuthConfig,
} from "../../src/slack/client.js";

/**
 * Integration test to verify that after updateClientCredentials is called,
 * subsequent calls to getSlackClient return a client with the new credentials.
 *
 * This test does NOT mock updateClientCredentials to ensure the actual
 * credential update mechanism works correctly.
 */
describe("Client credential update integration", () => {
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
    resetSlackClient();
  });

  it("verifies the complete flow: initial client → update → new client", () => {
    // Setup initial credentials
    process.env.SLACK_USER_TOKEN = "xoxc-initial-token-12345";
    process.env.SLACK_COOKIE_D = "xoxd-initial-cookie-67890";

    // Step 1: Get initial client
    const initialClient = getSlackClient();
    expect(initialClient).toBeDefined();

    // Step 2: Verify initial auth config
    const initialConfig = resolveAuthConfig();
    expect(initialConfig.type).toBe("user");
    expect(initialConfig.token).toBe("xoxc-initial-token-12345");
    if (initialConfig.type === "user") {
      expect(initialConfig.cookie).toBe("xoxd-initial-cookie-67890");
    }

    // Step 3: Call updateClientCredentials with new credentials
    // This simulates what happens after a successful refresh
    updateClientCredentials("xoxc-new-refreshed-token", "xoxd-new-refreshed-cookie");

    // Step 4: Verify auth config is updated
    const updatedConfig = resolveAuthConfig();
    expect(updatedConfig.type).toBe("user");
    expect(updatedConfig.token).toBe("xoxc-new-refreshed-token");
    if (updatedConfig.type === "user") {
      expect(updatedConfig.cookie).toBe("xoxd-new-refreshed-cookie");
    }

    // Step 5: Get client again - should be a NEW instance
    const newClient = getSlackClient();
    expect(newClient).toBeDefined();

    // The client instance should be different (new client was created)
    expect(newClient).not.toBe(initialClient);

    // Step 6: Multiple subsequent calls should return the SAME new client
    const sameClient1 = getSlackClient();
    const sameClient2 = getSlackClient();
    expect(sameClient1).toBe(newClient);
    expect(sameClient2).toBe(newClient);
  });

  it("ensures tools get the updated client after refresh", () => {
    // Setup initial credentials
    process.env.SLACK_USER_TOKEN = "xoxc-old-token-abc";
    process.env.SLACK_COOKIE_D = "xoxd-old-cookie-xyz";

    // Simulate a tool calling getSlackClient before refresh
    const clientBeforeRefresh = getSlackClient();

    // Simulate refresh happening
    updateClientCredentials("xoxc-fresh-token-def", "xoxd-fresh-cookie-uvw");

    // Simulate same or another tool calling getSlackClient after refresh
    const clientAfterRefresh = getSlackClient();

    // The client after refresh should be different from before
    expect(clientAfterRefresh).not.toBe(clientBeforeRefresh);

    // The config should reflect the new credentials
    const config = resolveAuthConfig();
    expect(config.token).toBe("xoxc-fresh-token-def");
    if (config.type === "user") {
      expect(config.cookie).toBe("xoxd-fresh-cookie-uvw");
    }
  });

  it("maintains singleton behavior between updates", () => {
    process.env.SLACK_USER_TOKEN = "xoxc-test-token-111";
    process.env.SLACK_COOKIE_D = "xoxd-test-cookie-222";

    // Get client multiple times - should be same instance
    const client1 = getSlackClient();
    const client2 = getSlackClient();
    const client3 = getSlackClient();
    expect(client1).toBe(client2);
    expect(client2).toBe(client3);

    // Update credentials
    updateClientCredentials("xoxc-test-token-333", "xoxd-test-cookie-444");

    // Get client multiple times after update - should be same NEW instance
    const newClient1 = getSlackClient();
    const newClient2 = getSlackClient();
    const newClient3 = getSlackClient();
    expect(newClient1).toBe(newClient2);
    expect(newClient2).toBe(newClient3);

    // But different from the old instance
    expect(newClient1).not.toBe(client1);
  });
});
