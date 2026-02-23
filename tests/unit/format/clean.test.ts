import { describe, it, expect } from "vitest";
import { stripEmpty } from "../../../src/utils/format/clean.js";

describe("stripEmpty", () => {
  it("removes null values from objects", () => {
    expect(stripEmpty({ a: 1, b: null })).toEqual({ a: 1 });
  });

  it("removes undefined values from objects", () => {
    expect(stripEmpty({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it("removes empty strings from objects", () => {
    expect(stripEmpty({ a: "hello", b: "" })).toEqual({ a: "hello" });
  });

  it("removes empty arrays from objects", () => {
    expect(stripEmpty({ a: [1], b: [] })).toEqual({ a: [1] });
  });

  it("preserves false", () => {
    expect(stripEmpty({ a: false, b: null })).toEqual({ a: false });
  });

  it("preserves 0", () => {
    expect(stripEmpty({ a: 0, b: null })).toEqual({ a: 0 });
  });

  it("recursively cleans nested objects", () => {
    const input = {
      a: 1,
      b: {
        c: null,
        d: "hello",
        e: {
          f: "",
          g: 42,
        },
      },
    };
    expect(stripEmpty(input)).toEqual({
      a: 1,
      b: {
        d: "hello",
        e: { g: 42 },
      },
    });
  });

  it("cleans objects inside arrays", () => {
    const input = [
      { a: 1, b: null },
      { c: "", d: "ok" },
    ];
    expect(stripEmpty(input)).toEqual([{ a: 1 }, { d: "ok" }]);
  });

  it("removes null entries from arrays", () => {
    expect(stripEmpty([1, null, 3])).toEqual([1, 3]);
  });

  it("handles deeply nested empty structures", () => {
    const input = {
      a: {
        b: {
          c: null,
          d: [],
          e: "",
        },
      },
      f: "keep",
    };
    // Inner objects become empty after stripping → they get stripped too
    expect(stripEmpty(input)).toEqual({ f: "keep" });
  });

  it("returns primitive values unchanged", () => {
    expect(stripEmpty(42)).toBe(42);
    expect(stripEmpty("hello")).toBe("hello");
    expect(stripEmpty(true)).toBe(true);
    expect(stripEmpty(false)).toBe(false);
  });

  it("handles a realistic Slack message", () => {
    const msg = {
      ts: "1771574618.875419",
      userId: "U123",
      text: "hello",
      threadTs: null,
      replyCount: null,
      reactions: [],
    };
    expect(stripEmpty(msg)).toEqual({
      ts: "1771574618.875419",
      userId: "U123",
      text: "hello",
    });
  });

  it("preserves arrays with content", () => {
    expect(stripEmpty({ items: [1, 2, 3] })).toEqual({ items: [1, 2, 3] });
  });

  it("handles object with all empty values", () => {
    expect(stripEmpty({ a: null, b: "", c: [] })).toEqual({});
  });

  it("handles nested empty objects that collapse", () => {
    const input = { a: { b: { c: null } } };
    // After stripping c: null → b becomes {} → a becomes {} → top becomes {}
    expect(stripEmpty(input)).toEqual({});
  });

  it("preserves string '0' and string 'false'", () => {
    expect(stripEmpty({ a: "0", b: "false" })).toEqual({
      a: "0",
      b: "false",
    });
  });
});
