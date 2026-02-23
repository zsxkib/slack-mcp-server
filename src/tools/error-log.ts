import { z } from "zod";
import { server } from "../server.js";
import { readErrors, clearErrors } from "../utils/error-log.js";

// ── get_error_log ──
server.registerTool(
  "get_error_log",
  {
    description:
      "Read recent errors from the server error log. Shows what went wrong and when. " +
      "Use after Slack tool failures to diagnose issues.",
    inputSchema: {
      limit: z
        .number()
        .min(1)
        .max(500)
        .optional()
        .describe("Maximum entries to return (default: 50)"),
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  async ({ limit }: { limit?: number }) => {
    const entries = readErrors(limit ?? 50);

    // Build summary stats
    const codeCounts: Record<string, number> = {};
    for (const entry of entries) {
      codeCounts[entry.code] = (codeCounts[entry.code] ?? 0) + 1;
    }

    const output = {
      total: entries.length,
      codeCounts,
      entries,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(output),
        },
      ],
      structuredContent: output,
    };
  }
);

// ── clear_error_log ──
server.registerTool(
  "clear_error_log",
  {
    description:
      "Clear error log entries after diagnosing and fixing issues. " +
      "Optionally clear only entries before a timestamp.",
    inputSchema: {
      before: z
        .string()
        .optional()
        .describe(
          "ISO timestamp — clear entries before this time. Omit to clear all."
        ),
    },
    annotations: {
      destructiveHint: false,
    },
  },
  async ({ before }: { before?: string }) => {
    if (before !== undefined && isNaN(new Date(before).getTime())) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: Invalid timestamp format. Use ISO 8601 (e.g., 2026-02-23T15:30:00.000Z).",
          },
        ],
        isError: true,
      };
    }

    const result = clearErrors(before);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result),
        },
      ],
      structuredContent: result,
    };
  }
);
