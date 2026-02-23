import { getSlackClient } from "../slack/client.js";

interface CachedChannel {
  id: string;
  name: string;
}

let channelMap: Map<string, CachedChannel> | null = null;
let populatePromise: Promise<void> | null = null;

async function populate(): Promise<void> {
  const client = getSlackClient();
  const map = new Map<string, CachedChannel>();
  let cursor: string | undefined;

  do {
    const response = await client.conversations.list({
      types: "public_channel",
      limit: 1000,
      cursor,
      exclude_archived: false,
    });

    if (!response.ok) break;

    for (const ch of response.channels ?? []) {
      if (ch.id && ch.name) {
        const entry = { id: ch.id, name: ch.name };
        map.set(ch.id, entry);
        map.set(ch.name.toLowerCase(), entry);
      }
    }

    cursor = response.response_metadata?.next_cursor || undefined;
  } while (cursor && cursor.length > 0);

  channelMap = map;
}

async function ensurePopulated(): Promise<void> {
  if (channelMap !== null) return;
  if (populatePromise === null) {
    populatePromise = populate().catch(() => {
      channelMap = new Map();
    });
  }
  await populatePromise;
}

/**
 * Resolves a channel input to a channel ID.
 * Accepts: "general", "#general", "General", "C123456"
 * Returns the channel ID, or the raw input if not found (fallback for private channels, DMs).
 */
export async function resolveChannelId(input: string): Promise<string> {
  // Quick passthrough for IDs (C..., D..., G... patterns)
  if (/^[CDG][A-Z0-9]+$/.test(input)) return input;

  await ensurePopulated();

  // Strip # prefix
  const name = input.startsWith("#") ? input.slice(1) : input;
  const entry = channelMap?.get(name.toLowerCase());

  return entry?.id ?? input;
}

export function reset(): void {
  channelMap = null;
  populatePromise = null;
}
