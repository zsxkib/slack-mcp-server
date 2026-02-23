import { describe, it, expect } from "vitest";
import {
  formatSlackTimestamp,
  formatRelativeTime,
} from "../../../src/utils/format/timestamps.js";

// Fixed reference time: Fri Feb 20, 2026 2:00 PM local
const NOW = new Date(2026, 1, 20, 14, 0, 0);
const toTs = (d: Date) => (d.getTime() / 1000).toString();

describe("formatRelativeTime", () => {
  it("returns 'just now' for < 1 min ago", () => {
    const ts = toTs(new Date(NOW.getTime() - 30_000));
    expect(formatRelativeTime(ts, NOW)).toBe("just now");
  });

  it("returns 'N min ago' for < 60 min", () => {
    const ts = toTs(new Date(NOW.getTime() - 5 * 60_000));
    expect(formatRelativeTime(ts, NOW)).toBe("5 min ago");
  });

  it("returns 'today at ...' for earlier today", () => {
    const ts = toTs(new Date(2026, 1, 20, 11, 0, 0));
    expect(formatRelativeTime(ts, NOW)).toBe("today at 11:00 AM");
  });

  it("returns 'yesterday at ...'", () => {
    const ts = toTs(new Date(2026, 1, 19, 10, 3, 0));
    expect(formatRelativeTime(ts, NOW)).toBe("yesterday at 10:03 AM");
  });

  it("returns 'DayName at ...' for 2-6 days ago", () => {
    const ts = toTs(new Date(2026, 1, 17, 15, 45, 0));
    expect(formatRelativeTime(ts, NOW)).toBe("Tue at 3:45 PM");
  });

  it("returns 'Month Day at ...' for this year", () => {
    const ts = toTs(new Date(2026, 1, 10, 9, 30, 0));
    expect(formatRelativeTime(ts, NOW)).toBe("Feb 10 at 9:30 AM");
  });

  it("returns 'Month Day, Year at ...' for older", () => {
    const ts = toTs(new Date(2025, 11, 3, 16, 15, 0));
    expect(formatRelativeTime(ts, NOW)).toBe("Dec 3, 2025 at 4:15 PM");
  });

  it("returns original for non-numeric input", () => {
    expect(formatRelativeTime("not-a-ts", NOW)).toBe("not-a-ts");
  });
});

describe("formatSlackTimestamp", () => {
  it("embeds the raw ts in parens for API traversal", () => {
    const ts = toTs(new Date(NOW.getTime() - 5 * 60_000));
    const result = formatSlackTimestamp(ts, NOW);
    expect(result).toBe(`5 min ago (${ts})`);
  });

  it("includes relative time before the ts", () => {
    const ts = toTs(new Date(2026, 1, 19, 10, 3, 0));
    const result = formatSlackTimestamp(ts, NOW);
    expect(result).toContain("yesterday at 10:03 AM");
    expect(result).toContain(`(${ts})`);
  });

  it("returns original for non-numeric input", () => {
    expect(formatSlackTimestamp("not-a-ts", NOW)).toBe("not-a-ts");
  });

  it("returns original for empty string", () => {
    expect(formatSlackTimestamp("", NOW)).toBe("");
  });

  it("handles midnight correctly", () => {
    const ts = toTs(new Date(2026, 0, 1, 0, 0, 0));
    expect(formatSlackTimestamp(ts, NOW)).toContain("12:00 AM");
  });

  it("handles noon correctly", () => {
    const ts = toTs(new Date(2026, 1, 20, 12, 0, 0));
    expect(formatSlackTimestamp(ts, NOW)).toContain("12:00 PM");
  });

  it("pads single-digit minutes", () => {
    const ts = toTs(new Date(2026, 1, 20, 9, 5, 0));
    expect(formatSlackTimestamp(ts, NOW)).toContain("9:05 AM");
  });
});
