import { getDisplayName } from "../../cache/user-cache.js";

/**
 * Decodes Slack HTML entities.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Resolves all <@U...> user mentions in text using the user cache.
 */
async function resolveUserMentions(text: string): Promise<string> {
  const mentionPattern = /<@(U[A-Z0-9]+)>/g;
  const matches = [...text.matchAll(mentionPattern)];
  if (matches.length === 0) return text;

  // Collect unique user IDs
  const userIds = [...new Set(matches.map((m) => m[1]!))];

  // Resolve all in parallel
  const names = await Promise.all(
    userIds.map(async (id) => ({ id, name: await getDisplayName(id) }))
  );
  const nameMap = new Map(names.map(({ id, name }) => [id, name]));

  return text.replace(mentionPattern, (_match, userId: string) => {
    return `@${nameMap.get(userId) ?? userId}`;
  });
}

/**
 * Converts Slack link markup to readable formats.
 * - <URL|text> → [text](URL)
 * - <URL> → URL
 * - <#C123|general> → #general
 * - <@U123> handled separately by resolveUserMentions
 */
function convertLinks(text: string): string {
  return text.replace(/<([^>]+)>/g, (_match, inner: string) => {
    // Skip user mentions — handled by resolveUserMentions
    if (inner.startsWith("@U")) return _match;

    // Channel references: <#C123|general> → #general
    if (inner.startsWith("#")) {
      const pipeIdx = inner.indexOf("|");
      if (pipeIdx !== -1) {
        return `#${inner.slice(pipeIdx + 1)}`;
      }
      return `#${inner.slice(1)}`;
    }

    // URL with label: <URL|text> → [text](URL)
    const pipeIdx = inner.indexOf("|");
    if (pipeIdx !== -1) {
      const url = inner.slice(0, pipeIdx);
      const label = inner.slice(pipeIdx + 1);
      return `[${label}](${url})`;
    }

    // Plain URL: <URL> → URL
    return inner;
  });
}

/**
 * Cleans Slack markup in a text string:
 * 1. Convert links and channel refs
 * 2. Resolve @mentions via user cache
 * 3. Decode HTML entities (last, so entities inside links are preserved)
 */
export async function cleanSlackText(text: string): Promise<string> {
  if (!text) return text;
  let result = convertLinks(text);
  result = await resolveUserMentions(result);
  result = decodeEntities(result);
  return result;
}
