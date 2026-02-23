import { getSlackClient } from "../slack/client.js";

interface CachedUser {
  id: string;
  displayName: string;
}

let userMap: Map<string, CachedUser> | null = null;
let populatePromise: Promise<void> | null = null;

/**
 * Determines the best display name for a Slack user.
 * Priority: display_name > real_name > name > raw ID
 */
function pickDisplayName(member: {
  id?: string;
  name?: string;
  real_name?: string;
  profile?: { display_name?: string };
}): string {
  const display = member.profile?.display_name;
  if (display && display.trim().length > 0) return display.trim();
  const real = member.real_name;
  if (real && real.trim().length > 0) return real.trim();
  const name = member.name;
  if (name && name.trim().length > 0) return name.trim();
  return member.id ?? "unknown";
}

/**
 * Populates the cache by paginating through users.list.
 */
async function populate(): Promise<void> {
  const client = getSlackClient();
  const map = new Map<string, CachedUser>();
  let cursor: string | undefined;

  do {
    const response = await client.users.list({
      limit: 1000,
      cursor,
    });

    if (!response.ok) break;

    for (const member of response.members ?? []) {
      if (member.id) {
        map.set(member.id, {
          id: member.id,
          displayName: pickDisplayName(member),
        });
      }
    }

    cursor = response.response_metadata?.next_cursor || undefined;
  } while (cursor && cursor.length > 0);

  userMap = map;
}

/**
 * Ensures the cache is populated. Safe to call multiple times — only fetches once.
 */
async function ensurePopulated(): Promise<void> {
  if (userMap !== null) return;
  if (populatePromise === null) {
    populatePromise = populate().catch(() => {
      // On failure, set empty map so we fall back to raw IDs gracefully
      userMap = new Map();
    });
  }
  await populatePromise;
}

/**
 * Resolves a user ID to "displayName (userId)" format.
 * Falls back to the raw ID if user is unknown.
 */
export async function resolve(userId: string): Promise<string> {
  await ensurePopulated();
  const user = userMap?.get(userId);
  if (!user) return userId;
  return `${user.displayName} (${userId})`;
}

/**
 * Returns just the display name for a user ID.
 * Falls back to the raw ID if user is unknown.
 */
export async function getDisplayName(userId: string): Promise<string> {
  await ensurePopulated();
  const user = userMap?.get(userId);
  return user?.displayName ?? userId;
}

/**
 * Batch-resolves an array of user IDs to "displayName (userId)" format.
 * Deduplicates internally for efficiency.
 */
export async function resolveMany(
  userIds: string[]
): Promise<Map<string, string>> {
  await ensurePopulated();
  const result = new Map<string, string>();
  for (const id of new Set(userIds)) {
    const user = userMap?.get(id);
    result.set(id, user ? `${user.displayName} (${id})` : id);
  }
  return result;
}

/**
 * Resets the cache. Intended for testing only.
 */
export function reset(): void {
  userMap = null;
  populatePromise = null;
}
