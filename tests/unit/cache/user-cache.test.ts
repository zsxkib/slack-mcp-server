import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve, getDisplayName, resolveMany, reset } from "../../../src/cache/user-cache.js";

// Mock the Slack client
const mockUsersList = vi.fn();
vi.mock("../../../src/slack/client.js", () => ({
  getSlackClient: () => ({
    users: {
      list: mockUsersList,
    },
  }),
}));

const MOCK_MEMBERS = [
  {
    id: "U001",
    name: "alice",
    real_name: "Alice Smith",
    profile: { display_name: "alice" },
  },
  {
    id: "U002",
    name: "carol",
    real_name: "Carol Davis",
    profile: { display_name: "" },
  },
  {
    id: "U003",
    name: "dave",
    real_name: "",
    profile: { display_name: "" },
  },
  {
    id: "U004",
    name: "",
    real_name: "",
    profile: {},
  },
];

beforeEach(() => {
  reset();
  mockUsersList.mockReset();
  mockUsersList.mockResolvedValue({
    ok: true,
    members: MOCK_MEMBERS,
    response_metadata: { next_cursor: "" },
  });
});

describe("resolve", () => {
  it("returns displayName (userId) for known users", async () => {
    expect(await resolve("U001")).toBe("alice (U001)");
  });

  it("falls back to real_name when display_name is empty", async () => {
    expect(await resolve("U002")).toBe("Carol Davis (U002)");
  });

  it("falls back to name when real_name is also empty", async () => {
    expect(await resolve("U003")).toBe("dave (U003)");
  });

  it("falls back to raw ID when all names are empty", async () => {
    // U004 has no display_name, real_name, or name
    expect(await resolve("U004")).toBe("U004 (U004)");
  });

  it("returns raw ID for unknown users", async () => {
    expect(await resolve("UUNKNOWN")).toBe("UUNKNOWN");
  });

  it("only calls users.list once across multiple resolves", async () => {
    await resolve("U001");
    await resolve("U002");
    await resolve("U003");
    expect(mockUsersList).toHaveBeenCalledTimes(1);
  });
});

describe("getDisplayName", () => {
  it("returns just the display name", async () => {
    expect(await getDisplayName("U001")).toBe("alice");
  });

  it("returns raw ID for unknown users", async () => {
    expect(await getDisplayName("UUNKNOWN")).toBe("UUNKNOWN");
  });

  it("falls back through name priority", async () => {
    expect(await getDisplayName("U002")).toBe("Carol Davis");
    expect(await getDisplayName("U003")).toBe("dave");
  });
});

describe("resolveMany", () => {
  it("batch-resolves multiple user IDs", async () => {
    const result = await resolveMany(["U001", "U002"]);
    expect(result.get("U001")).toBe("alice (U001)");
    expect(result.get("U002")).toBe("Carol Davis (U002)");
  });

  it("deduplicates IDs", async () => {
    const result = await resolveMany(["U001", "U001", "U001"]);
    expect(result.size).toBe(1);
    expect(result.get("U001")).toBe("alice (U001)");
  });

  it("handles unknown users in batch", async () => {
    const result = await resolveMany(["U001", "UUNKNOWN"]);
    expect(result.get("UUNKNOWN")).toBe("UUNKNOWN");
  });

  it("handles empty array", async () => {
    const result = await resolveMany([]);
    expect(result.size).toBe(0);
  });
});

describe("pagination", () => {
  it("fetches all pages", async () => {
    mockUsersList
      .mockResolvedValueOnce({
        ok: true,
        members: [{ id: "U001", name: "a", real_name: "A", profile: { display_name: "a" } }],
        response_metadata: { next_cursor: "cursor1" },
      })
      .mockResolvedValueOnce({
        ok: true,
        members: [{ id: "U002", name: "b", real_name: "B", profile: { display_name: "b" } }],
        response_metadata: { next_cursor: "" },
      });

    expect(await resolve("U001")).toBe("a (U001)");
    expect(await resolve("U002")).toBe("b (U002)");
    expect(mockUsersList).toHaveBeenCalledTimes(2);
  });
});

describe("error handling", () => {
  it("falls back gracefully when API fails", async () => {
    mockUsersList.mockRejectedValue(new Error("network error"));
    // Should not throw, just fall back to raw IDs
    expect(await resolve("U001")).toBe("U001");
  });

  it("falls back when API returns not ok", async () => {
    mockUsersList.mockResolvedValue({ ok: false });
    expect(await resolve("U001")).toBe("U001");
  });
});

describe("reset", () => {
  it("clears cache so next call re-fetches", async () => {
    await resolve("U001");
    expect(mockUsersList).toHaveBeenCalledTimes(1);

    reset();
    await resolve("U001");
    expect(mockUsersList).toHaveBeenCalledTimes(2);
  });
});
