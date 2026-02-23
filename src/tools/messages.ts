import { z } from "zod";
import { server } from "../server.js";
import { getSlackClient } from "../slack/client.js";
import type { Message, Reaction, FormattedMessage } from "../slack/types.js";
import { mapSlackError, formatErrorForMcp } from "../utils/errors.js";
import { buildCursorPaginationResult } from "../utils/pagination.js";
import { formatRelativeTime } from "../utils/format/timestamps.js";
import { compressReactions } from "../utils/format/reactions.js";
import { cleanSlackText } from "../utils/format/slack-markup.js";
import { resolve as resolveUser } from "../cache/user-cache.js";
import { resolveChannelId } from "../cache/channel-cache.js";
import { stripEmpty } from "../utils/format/clean.js";

interface SlackReaction {
  name?: string;
  count?: number;
  users?: string[];
}

interface SlackMessage {
  ts?: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: SlackReaction[];
}

function mapMessage(msg: SlackMessage): Message {
  const reactions: Reaction[] = (msg.reactions ?? []).map((r) => ({
    name: r.name ?? "",
    count: r.count ?? 0,
    users: r.users ?? [],
  }));

  return {
    ts: msg.ts ?? "",
    userId: msg.user ?? "",
    text: msg.text ?? "",
    threadTs: msg.thread_ts ?? null,
    replyCount: msg.reply_count ?? null,
    reactions,
  };
}

/**
 * Applies the full formatting pipeline to an array of raw messages.
 */
async function formatMessages(
  messages: Message[]
): Promise<FormattedMessage[]> {
  // 1. Batch-resolve user IDs to "displayName (userId)" format
  const userIds = [...new Set(messages.map((m) => m.userId))];
  const displayNames = new Map<string, string>();
  for (const id of userIds) {
    displayNames.set(id, await resolveUser(id));
  }

  // 2. Format each message
  const formatted = await Promise.all(
    messages.map(async (msg) => {
      const result: FormattedMessage = {
        id: msg.ts,
        time: formatRelativeTime(msg.ts),
        user: displayNames.get(msg.userId) ?? msg.userId,
        text: await cleanSlackText(msg.text),
        threadId: msg.threadTs ?? undefined,
        replyCount: msg.replyCount ?? undefined,
        reactions: compressReactions(msg.reactions),
      };
      return result;
    })
  );

  // 3. Strip empties, then restore required fields
  const stripped = stripEmpty(formatted) as FormattedMessage[];
  return stripped.map(msg => ({ ...msg, text: msg.text ?? "" }));
}

const formattedMessageSchema = z.object({
  id: z.string().describe("Message ID — pass to ts params"),
  time: z.string().describe("Human-readable time"),
  user: z.string().describe("Display name with user ID: 'name (U...)'"),
  text: z.string().describe("Message text (cleaned markup, resolved mentions)"),
  threadId: z.string().optional().describe("Thread ID — pass to get_thread_replies thread_ts param. Only present on thread replies."),
  replyCount: z.number().optional().describe("Number of thread replies"),
  reactions: z.record(z.string(), z.number()).optional().describe("Emoji reactions {name: count}"),
});

const messagesOutputSchema = {
  messages: z.array(formattedMessageSchema).describe("List of messages"),
  nextCursor: z
    .string()
    .nullable()
    .optional()
    .describe("Cursor for next page"),
};

const channelHistoryInputSchema = {
  channel_id: z.string().describe("Channel ID (C123) or name ('general', '#general')"),
  limit: z
    .number()
    .min(1)
    .max(1000)
    .optional()
    .describe("Maximum messages to return (default: 50)"),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor from previous response"),
  oldest: z
    .string()
    .optional()
    .describe(
      "Only messages after this timestamp. Unix epoch with microseconds (e.g. '1706745600.000000'). " +
      "Can be a message 'id' or a computed epoch for time-based queries."
    ),
  latest: z
    .string()
    .optional()
    .describe(
      "Only messages before this timestamp. Unix epoch with microseconds (e.g. '1706745600.000000'). " +
      "Can be a message 'id' or a computed epoch for time-based queries."
    ),
};

server.registerTool(
  "get_channel_history",
  {
    description:
      "Get messages from a channel. Accepts channel ID or name (e.g. 'general'). " +
      "Each message has an 'id' and optionally 'threadId'. " +
      "To read a thread, pass the threadId (NOT the message id) as thread_ts to get_thread_replies. " +
      "Slack URLs: extract channel ID from /archives/C.../p..., convert p-timestamp by inserting dot before last 6 digits (p1234567890123456 → 1234567890.123456). " +
      "Typical flow: search_messages → get_channel_history → get_thread_replies.",
    inputSchema: channelHistoryInputSchema,
    outputSchema: messagesOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ channel_id, limit, cursor, oldest, latest }) => {
    let resolvedChannelId = channel_id;
    try {
      resolvedChannelId = await resolveChannelId(channel_id);
      const client = getSlackClient();
      const response = await client.conversations.history({
        channel: resolvedChannelId,
        limit: limit ?? 50,
        cursor: cursor ?? undefined,
        oldest: oldest ?? undefined,
        latest: latest ?? undefined,
      });

      if (!response.ok) {
        throw new Error(response.error ?? "Unknown Slack API error");
      }

      const rawMessages = (response.messages ?? []).map((msg) =>
        mapMessage(msg as SlackMessage)
      );

      const messages = await formatMessages(rawMessages);

      const result = buildCursorPaginationResult(
        messages,
        response.response_metadata
      );

      const output = stripEmpty({
        messages: result.items,
        nextCursor: result.nextCursor,
      });

      // Restore required text field stripped by stripEmpty (file shares, bot messages have no text)
      for (const m of output.messages) {
        if (!("text" in m)) (m as Record<string, unknown>).text = "";
      }

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
      const mcpError = mapSlackError(error, { channelId: resolvedChannelId });
      return formatErrorForMcp(mcpError);
    }
  }
);

const threadRepliesInputSchema = {
  channel_id: z.string().describe("Channel ID or name containing the thread"),
  thread_ts: z
    .string()
    .describe(
      "Timestamp of the parent message (e.g. '1706745600.123456'). Use the threadId from message output, NOT the message id."
    ),
  limit: z
    .number()
    .min(1)
    .max(1000)
    .optional()
    .describe("Maximum replies to return (default: 50)"),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor from previous response"),
};

server.registerTool(
  "get_thread_replies",
  {
    description:
      "Get thread replies. Accepts channel ID or name. Pass the threadId from a message as thread_ts. Do NOT pass a regular message id — that causes thread_not_found errors.",
    inputSchema: threadRepliesInputSchema,
    outputSchema: messagesOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ channel_id, thread_ts, limit, cursor }) => {
    let resolvedChannelId = channel_id;
    try {
      resolvedChannelId = await resolveChannelId(channel_id);
      const client = getSlackClient();
      const response = await client.conversations.replies({
        channel: resolvedChannelId,
        ts: thread_ts,
        limit: limit ?? 50,
        cursor: cursor ?? undefined,
      });

      if (!response.ok) {
        throw new Error(response.error ?? "Unknown Slack API error");
      }

      const rawMessages = (response.messages ?? []).map((msg) =>
        mapMessage(msg as SlackMessage)
      );

      const messages = await formatMessages(rawMessages);

      const result = buildCursorPaginationResult(
        messages,
        response.response_metadata
      );

      const output = stripEmpty({
        messages: result.items,
        nextCursor: result.nextCursor,
      });

      // Restore required text field stripped by stripEmpty (file shares, bot messages have no text)
      for (const m of output.messages) {
        if (!("text" in m)) (m as Record<string, unknown>).text = "";
      }

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
      const mcpError = mapSlackError(error, {
        channelId: resolvedChannelId,
        threadTs: thread_ts,
      });
      return formatErrorForMcp(mcpError);
    }
  }
);
