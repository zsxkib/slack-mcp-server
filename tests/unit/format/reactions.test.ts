import { describe, it, expect } from "vitest";
import { compressReactions } from "../../../src/utils/format/reactions.js";

describe("compressReactions", () => {
  it("compresses reactions to name:count map", () => {
    const reactions = [
      { name: "tada", count: 3, users: ["U1", "U2", "U3"] },
      { name: "thumbsup", count: 1, users: ["U4"] },
    ];
    expect(compressReactions(reactions)).toEqual({
      tada: 3,
      thumbsup: 1,
    });
  });

  it("returns undefined for empty array", () => {
    expect(compressReactions([])).toBeUndefined();
  });

  it("handles single reaction", () => {
    const reactions = [{ name: "heart", count: 5, users: ["U1"] }];
    expect(compressReactions(reactions)).toEqual({ heart: 5 });
  });

  it("skips reactions with empty name", () => {
    const reactions = [
      { name: "", count: 1, users: ["U1"] },
      { name: "ok", count: 2, users: ["U2", "U3"] },
    ];
    expect(compressReactions(reactions)).toEqual({ ok: 2 });
  });

  it("returns undefined when all reactions have empty names", () => {
    const reactions = [{ name: "", count: 1, users: ["U1"] }];
    expect(compressReactions(reactions)).toBeUndefined();
  });

  it("handles many reactions", () => {
    const reactions = [
      { name: "a", count: 1, users: [] },
      { name: "b", count: 2, users: [] },
      { name: "c", count: 3, users: [] },
      { name: "d", count: 4, users: [] },
      { name: "e", count: 5, users: [] },
    ];
    const result = compressReactions(reactions);
    expect(result).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5 });
  });

  it("preserves zero counts", () => {
    const reactions = [{ name: "wave", count: 0, users: [] }];
    expect(compressReactions(reactions)).toEqual({ wave: 0 });
  });

  it("strips user ID arrays (only keeps count)", () => {
    const reactions = [
      {
        name: "rocket",
        count: 3,
        users: ["U001", "U002", "U003"],
      },
    ];
    const result = compressReactions(reactions);
    expect(result).toEqual({ rocket: 3 });
    // No users property in the result
    expect(result).not.toHaveProperty("users");
  });
});
