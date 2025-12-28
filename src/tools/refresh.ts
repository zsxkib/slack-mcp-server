import { z } from "zod";
import { server } from "../server.js";
import { getAuthType, isRefreshAvailable } from "../slack/client.js";
import { getScheduler } from "../refresh/scheduler.js";

// Output schema for the refresh_credentials tool using Zod
const outputSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  refreshedAt: z.string().optional(),
  totalRefreshes: z.number().int().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
});

type RefreshOutput = z.infer<typeof outputSchema>;

server.registerTool(
  "refresh_credentials",
  {
    description:
      "Manually trigger a refresh of Slack user credentials (token and cookie). " +
      "Returns the refresh result including success status and any error details. " +
      "Only available when using user token authentication.",
    inputSchema: {},
    outputSchema,
  },
  async () => {
    // Check if using bot token authentication
    const authType = getAuthType();
    if (authType === "bot") {
      const output: RefreshOutput = {
        success: false,
        error: {
          code: "REFRESH_NOT_AVAILABLE",
          message:
            "Credential refresh is only available for user token authentication. " +
            "Bot tokens do not expire.",
          retryable: false,
        },
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    }

    // Check if refresh is available (workspace configured)
    if (!isRefreshAvailable()) {
      const output: RefreshOutput = {
        success: false,
        error: {
          code: "REFRESH_NOT_AVAILABLE",
          message:
            "Credential refresh is not available. " +
            "Ensure SLACK_WORKSPACE environment variable is set.",
          retryable: false,
        },
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    }

    // Trigger manual refresh via scheduler
    const scheduler = getScheduler();
    const result = await scheduler.triggerManual();

    if (result.success) {
      const output: RefreshOutput = {
        success: true,
        message: "Credentials refreshed successfully",
        refreshedAt: result.credentials.metadata.lastRefreshed,
        totalRefreshes: result.credentials.metadata.refreshCount,
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    } else {
      const output: RefreshOutput = {
        success: false,
        error: {
          code: result.error.code,
          message: result.error.message,
          retryable: result.error.retryable,
        },
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    }
  }
);
