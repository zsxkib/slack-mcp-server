import { z } from "zod";
import { server } from "../server.js";
import { getSlackClient, isSearchAvailable } from "../slack/client.js";
import type { FormattedSearchResult } from "../slack/types.js";
import { mapSlackError, formatErrorForMcp, AUTH_ERRORS } from "../utils/errors.js";
import { formatRelativeTime } from "../utils/format/timestamps.js";
import { cleanSlackText } from "../utils/format/slack-markup.js";
import { resolve as resolveUser, getDisplayName } from "../cache/user-cache.js";
import { stripEmpty } from "../utils/format/clean.js";

interface SlackSearchMatch {
  ts?: string;
  text?: string;
  user?: string;
  username?: string;
  channel?: {
    id?: string;
    name?: string;
  };
  permalink?: string;
  thread_ts?: string;
}

interface SlackSearchMessages {
  matches?: SlackSearchMatch[];
  total?: number;
  page?: number;
  paging?: {
    count?: number;
    total?: number;
    page?: number;
    pages?: number;
  };
}

interface RawSearchResult {
  ts: string;
  text: string;
  userId: string;
  channelId: string;
  channelName: string;
  threadTs?: string;
}

function mapSearchResult(match: SlackSearchMatch): RawSearchResult {
  return {
    ts: match.ts ?? "",
    text: match.text ?? "",
    userId: match.user ?? "",
    channelId: match.channel?.id ?? "",
    channelName: match.channel?.name ?? "",
    threadTs: match.thread_ts,
  };
}

/**
 * Resolves DM channel names (matching ^U[A-Z0-9]+$) to "DM: displayName".
 */
async function resolveDmChannelName(name: string): Promise<string> {
  if (/^U[A-Z0-9]+$/.test(name)) {
    const displayName = await getDisplayName(name);
    return `DM: ${displayName}`;
  }
  return name;
}

/**
 * Formats a channel as "#name (ID)" for combined display + API traversal.
 */
async function formatChannel(name: string, id: string): Promise<string> {
  const resolvedName = await resolveDmChannelName(name);
  if (resolvedName.startsWith("DM:")) {
    return `${resolvedName} (${id})`;
  }
  return `#${resolvedName} (${id})`;
}

/**
 * Fetches the thread parent message for a search result.
 */
async function fetchThreadParent(
  channelId: string,
  threadTs: string
): Promise<{ user: string; time: string; text: string } | undefined> {
  try {
    const client = getSlackClient();
    const response = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 1,
    });

    if (!response.ok || !response.messages?.length) return undefined;

    const parent = response.messages[0]!;
    const userId = (parent as { user?: string }).user ?? "";
    const text = (parent as { text?: string }).text ?? "";
    const ts = (parent as { ts?: string }).ts ?? "";

    const userName = userId ? await getDisplayName(userId) : "";
    const cleanedText = await cleanSlackText(text);
    const truncatedText =
      cleanedText.length > 200 ? cleanedText.slice(0, 200) + "\u2026" : cleanedText;

    return {
      user: userName,
      time: formatRelativeTime(ts),
      text: truncatedText,
    };
  } catch {
    return undefined;
  }
}

/**
 * Applies the formatting pipeline to search results.
 */
async function formatSearchResults(
  results: RawSearchResult[]
): Promise<FormattedSearchResult[]> {
  // 1. Batch-resolve user IDs to "displayName (userId)" format
  const userIds = [...new Set(results.map((r) => r.userId))];
  const displayNames = new Map<string, string>();
  for (const id of userIds) {
    displayNames.set(id, await resolveUser(id));
  }

  // 2. Fetch thread parents (deduplicated)
  const parentFetchKeys = new Map<string, Promise<{ user: string; time: string; text: string } | undefined>>();
  for (const r of results) {
    if (r.threadTs && r.threadTs !== r.ts) {
      const key = `${r.channelId}:${r.threadTs}`;
      if (!parentFetchKeys.has(key)) {
        parentFetchKeys.set(key, fetchThreadParent(r.channelId, r.threadTs));
      }
    }
  }
  const parentResults = new Map<string, { user: string; time: string; text: string } | undefined>();
  for (const [key, promise] of parentFetchKeys) {
    parentResults.set(key, await promise);
  }

  // 3. Format each result
  const formatted = await Promise.all(
    results.map(async (r) => {
      let threadParent: { user: string; time: string; text: string } | undefined;
      if (r.threadTs && r.threadTs !== r.ts) {
        const key = `${r.channelId}:${r.threadTs}`;
        threadParent = parentResults.get(key);
      }

      const result: FormattedSearchResult = {
        id: r.ts,
        channel: await formatChannel(r.channelName, r.channelId),
        user: displayNames.get(r.userId) ?? r.userId,
        time: formatRelativeTime(r.ts),
        text: await cleanSlackText(r.text),
        threadId: (r.threadTs && r.threadTs !== r.ts) ? r.threadTs : undefined,
        threadParent,
      };
      return result;
    })
  );

  // Restore required text fields after strip (file shares, bot messages have no text)
  const stripped = stripEmpty(formatted) as FormattedSearchResult[];
  return stripped.map(r => ({
    ...r,
    text: r.text ?? "",
    ...(r.threadParent ? { threadParent: { ...r.threadParent, text: r.threadParent.text ?? "" } } : {}),
  }));
}

const searchMessagesInputSchema = {
  query: z
    .string()
    .describe(
      "Search query (supports Slack search modifiers: from:, in:, before:, after:)"
    ),
  sort: z
    .enum(["score", "timestamp"])
    .optional()
    .describe("Sort order (default: score)"),
  sort_dir: z
    .enum(["asc", "desc"])
    .optional()
    .describe("Sort direction (default: desc)"),
  count: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Results per page (default: 20)"),
  page: z.number().min(1).optional().describe("Page number (default: 1)"),
};

const threadParentSchema = z.object({
  user: z.string().describe("Display name"),
  time: z.string().describe("Relative time"),
  text: z.string().describe("Parent message text (max 200 chars)"),
});

const searchResultSchema = z.object({
  id: z.string().describe("Message ID — pass to ts params"),
  channel: z.string().describe("Channel as '#name (ID)' — parse ID in parens for API calls"),
  user: z.string().describe("Display name with user ID: 'name (U...)'"),
  time: z.string().describe("Human-readable time"),
  text: z.string().describe("Message text (cleaned markup)"),
  threadId: z.string().optional().describe("Thread ID — pass to get_thread_replies thread_ts param"),
  threadParent: threadParentSchema.optional().describe("Parent message context"),
});

const searchMessagesOutputSchema = {
  results: z.array(searchResultSchema).describe("Search results"),
  total: z.number().describe("Total matching messages"),
  page: z.string().describe("Current page as 'N/total'"),
};

server.registerTool(
  "search_messages",
  {
    description:
      "Search messages (REQUIRES user token — will fail with bot tokens). " +
      "Supports Slack search modifiers: 'from:@username', 'in:#general', 'before:2026-02-01', 'after:2026-01-15'. " +
      "Combine freely: 'deploy error in:#eng after:2026-02-01'. " +
      "Results include threadId for chaining to get_thread_replies.",
    inputSchema: searchMessagesInputSchema,
    outputSchema: searchMessagesOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ query, sort, sort_dir, count, page }) => {
    if (!isSearchAvailable()) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: search_requires_user_token - ${AUTH_ERRORS.SEARCH_REQUIRES_USER_TOKEN}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const client = getSlackClient();
      const response = await client.search.messages({
        query,
        sort: sort ?? "score",
        sort_dir: sort_dir ?? "desc",
        count: count ?? 20,
        page: page ?? 1,
      });

      if (!response.ok) {
        throw new Error(response.error ?? "Unknown Slack API error");
      }

      const messages = response.messages as SlackSearchMessages | undefined;
      const matches = messages?.matches ?? [];
      const paging = messages?.paging;

      const rawResults = matches.map(mapSearchResult);
      const results = await formatSearchResults(rawResults);

      const totalResults = paging?.total ?? results.length;
      const currentPage = paging?.page ?? 1;
      const totalPages = paging?.pages ?? 1;

      const output = {
        results,
        total: totalResults,
        page: `${currentPage}/${totalPages}`,
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
