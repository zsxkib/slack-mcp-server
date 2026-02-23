import type { Reaction } from "../../slack/types.js";

/**
 * Compact reaction format: { "emoji_name": count }
 */
export type CompactReactions = Record<string, number>;

/**
 * Compresses an array of Reaction objects into a compact { name: count } map.
 * Returns undefined when the input is empty (works well with stripEmpty).
 */
export function compressReactions(
  reactions: Reaction[]
): CompactReactions | undefined {
  if (reactions.length === 0) {
    return undefined;
  }

  const compact: CompactReactions = {};
  for (const r of reactions) {
    if (r.name) {
      compact[r.name] = r.count;
    }
  }

  return Object.keys(compact).length > 0 ? compact : undefined;
}
