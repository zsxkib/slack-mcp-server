import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server.js";

// Import tools to register them
import "./tools/channels.js";
import "./tools/messages.js";
import "./tools/users.js";
import "./tools/search.js";
import "./tools/refresh.js";

// Import refresh functionality
import {
  isRefreshAvailable,
  initializeFromStorage,
  getAuthType,
} from "./slack/client.js";
import { getScheduler } from "./refresh/scheduler.js";

/**
 * Initialize the credential refresh system
 */
async function initializeRefresh(): Promise<void> {
  const authType = getAuthType();

  if (authType !== "user") {
    console.error("[Startup] Using bot token authentication (refresh not needed)");
    return;
  }

  // Try to load persisted credentials
  await initializeFromStorage();

  // Check if refresh is available and start the scheduler
  if (isRefreshAvailable()) {
    const scheduler = getScheduler();
    scheduler.start();
    console.error("[Startup] Credential refresh scheduler started");
  } else {
    console.error(
      "[Startup] Credential refresh not available. " +
        "Set SLACK_WORKSPACE to enable auto-refresh."
    );
  }
}

async function main() {
  // Initialize refresh system before connecting
  try {
    await initializeRefresh();
  } catch (error) {
    console.error(
      `[Startup] Warning: Failed to initialize refresh system: ${error instanceof Error ? error.message : String(error)}`
    );
    // Continue anyway - we can still work without refresh
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Slack MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
