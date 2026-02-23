import { z } from "zod";
import { server } from "../server.js";
import { getSlackClient } from "../slack/client.js";
import type { Channel } from "../slack/types.js";
import { mapSlackError, formatErrorForMcp } from "../utils/errors.js";
import { buildCursorPaginationResult } from "../utils/pagination.js";

const listChannelsInputSchema = {
  limit: z
    .number()
    .min(1)
    .max(1000)
    .optional()
    .describe("Maximum number of channels to return (default: 100)"),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor from previous response"),
  exclude_archived: z
    .boolean()
    .optional()
    .describe("Exclude archived channels (default: true)"),
};

const channelSchema = z.object({
  id: z.string().describe("Channel ID"),
  name: z.string().describe("Channel name"),
  topic: z.string().nullable().describe("Channel topic"),
  purpose: z.string().nullable().describe("Channel purpose"),
  memberCount: z.number().describe("Number of members in the channel"),
  isArchived: z.boolean().describe("Whether the channel is archived"),
  created: z.number().describe("Unix timestamp when channel was created"),
});

const listChannelsOutputSchema = {
  channels: z.array(channelSchema).describe("List of channels"),
  nextCursor: z
    .string()
    .nullable()
    .describe("Cursor for next page, null if no more results"),
};

server.registerTool(
  "list_channels",
  {
    description: "List public channels. You can pass channel names directly to get_channel_history — no need to call this first just to get IDs.",
    inputSchema: listChannelsInputSchema,
    outputSchema: listChannelsOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit, cursor, exclude_archived }) => {
    try {
      const client = getSlackClient();
      const response = await client.conversations.list({
        types: "public_channel",
        limit: limit ?? 100,
        cursor: cursor ?? undefined,
        exclude_archived: exclude_archived ?? true,
      });

      if (!response.ok) {
        throw new Error(response.error ?? "Unknown Slack API error");
      }

      const channels: Channel[] = (response.channels ?? []).map((ch) => ({
        id: ch.id ?? "",
        name: ch.name ?? "",
        topic: ch.topic?.value ?? null,
        purpose: ch.purpose?.value ?? null,
        memberCount: ch.num_members ?? 0,
        isArchived: ch.is_archived ?? false,
        created: ch.created ?? 0,
      }));

      const result = buildCursorPaginationResult(
        channels,
        response.response_metadata
      );

      const output = {
        channels: result.items,
        nextCursor: result.nextCursor,
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
    } catch (error) {
      const mcpError = mapSlackError(error);
      return formatErrorForMcp(mcpError);
    }
  }
);
