import type { CursorPaginationResult } from "../slack/types.js";

export function buildCursorPaginationResult<T>(
  items: T[],
  responseMetadata?: { next_cursor?: string }
): CursorPaginationResult<T> {
  const nextCursor = responseMetadata?.next_cursor || null;
  return {
    items,
    nextCursor: nextCursor && nextCursor.length > 0 ? nextCursor : null,
  };
}
