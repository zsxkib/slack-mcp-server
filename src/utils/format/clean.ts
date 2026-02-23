/**
 * Recursively strips null, undefined, empty strings, and empty arrays from objects.
 * Preserves `false` and `0`.
 */
export function stripEmpty<T>(value: T): T {
  if (value === null || value === undefined) {
    return undefined as unknown as T;
  }

  if (Array.isArray(value)) {
    const filtered = value
      .map((item) => stripEmpty(item))
      .filter((item) => item !== undefined);
    return filtered as unknown as T;
  }

  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const cleaned = stripEmpty(val);
      if (cleaned === undefined || cleaned === null) continue;
      if (typeof cleaned === "string" && cleaned === "") continue;
      if (Array.isArray(cleaned) && cleaned.length === 0) continue;
      if (
        typeof cleaned === "object" &&
        !Array.isArray(cleaned) &&
        Object.keys(cleaned as Record<string, unknown>).length === 0
      )
        continue;
      result[key] = cleaned;
    }
    return result as unknown as T;
  }

  return value;
}
