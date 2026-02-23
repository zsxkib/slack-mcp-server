import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSearchMessages = vi.fn();
const mockConversationsReplies = vi.fn();
const mockUsersList = vi.fn();

vi.mock("../../../src/slack/client.js", () => ({
  getSlackClient: () => ({
    search: { messages: mockSearchMessages },
    conversations: { replies: mockConversationsReplies },
    users: { list: mockUsersList },
  }),
  isSearchAvailable: () => true,
}));

vi.mock("../../../src/server.js", () => {
  const handlers = new Map<string, Function>();
  return {
    server: {
      registerTool: (name: string, _opts: unknown, handler: Function) => {
        handlers.set(name, handler);
      },
      _handlers: handlers,
    },
  };
});

import { server } from "../../../src/server.js";
import "../../../src/tools/search.js";
import { reset as resetUserCache } from "../../../src/cache/user-cache.js";

const handlers = (server as unknown as { _handlers: Map<string, Function> })._handlers;
const searchMessages = handlers.get("search_messages")!;

beforeEach(() => {
  vi.clearAllMocks();
  resetUserCache();
  mockUsersList.mockResolvedValue({
    ok: true,
    members: [
      { id: "U001", name: "alice", real_name: "Alice Smith", profile: { display_name: "alice" } },
      { id: "U002", name: "carol", real_name: "Carol S", profile: { display_name: "carol" } },
    ],
    response_metadata: { next_cursor: "" },
  });
});

describe("search text:undefined crash fix (Phase 0)", () => {
  it("search result with text: undefined → output has text: ''", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [{ ts: "1771574618.000000", text: undefined, user: "U001", username: "alice", channel: { id: "C1", name: "g" }, permalink: "" }],
        paging: { total: 1, page: 1, pages: 1 },
      },
    });
    const result = await searchMessages({ query: "test" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results[0].text).toBe("");
  });

  it("search result with text: '' → output has text: ''", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [{ ts: "1771574618.000000", text: "", user: "U001", username: "alice", channel: { id: "C1", name: "g" }, permalink: "" }],
        paging: { total: 1, page: 1, pages: 1 },
      },
    });
    const result = await searchMessages({ query: "test" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results[0].text).toBe("");
  });

  it("threadParent with text: undefined → threadParent.text: ''", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [{ ts: "1771574700.000000", text: "reply", user: "U001", username: "alice", channel: { id: "C1", name: "g" }, permalink: "", thread_ts: "1771574600.000000" }],
        paging: { total: 1, page: 1, pages: 1 },
      },
    });
    mockConversationsReplies.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574600.000000", user: "U001", text: undefined }],
    });
    const result = await searchMessages({ query: "test" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results[0].threadParent).toBeDefined();
    expect(output.results[0].threadParent.text).toBe("");
  });
});

describe("search_messages formatting", () => {
  it("returns merged channel, display name, time+ts, no permalink/username", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [
          {
            ts: "1771574618.875419",
            text: "result &amp; more",
            user: "U001",
            username: "alice",
            channel: { id: "C123", name: "general" },
            permalink: "https://slack.com/msg/1",
          },
        ],
        paging: { total: 1, page: 1, pages: 1 },
      },
    });

    const result = await searchMessages({ query: "test" });
    const output = JSON.parse(result.content[0].text);
    const r = output.results[0];

    // Combined channel
    expect(r.channel).toBe("#general (C123)");
    // User is "displayName (userId)" format
    expect(r.user).toBe("alice (U001)");
    // Time is human-readable only — no embedded ts
    expect(r.time).not.toContain("(");
    // Separate id field has raw ts
    expect(r.id).toBe("1771574618.875419");
    // Text cleaned
    expect(r.text).toBe("result & more");
    // Killed fields
    expect(r.permalink).toBeUndefined();
    expect(r.username).toBeUndefined();
    expect(r.userId).toBeUndefined();
    expect(r.channelId).toBeUndefined();
    expect(r.channelName).toBeUndefined();
  });

  it("resolves DM channel names", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [
          {
            ts: "1771574618.000000",
            text: "dm",
            user: "U001",
            username: "alice",
            channel: { id: "D999", name: "U002" },
            permalink: "",
          },
        ],
        paging: { total: 1, page: 1, pages: 1 },
      },
    });

    const result = await searchMessages({ query: "test" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results[0].channel).toBe("DM: carol (D999)");
  });

  it("pagination is 'page/total' string", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [{ ts: "1771574618.000000", text: "x", user: "U001", username: "alice", channel: { id: "C1", name: "g" }, permalink: "" }],
        paging: { total: 500, page: 3, pages: 25 },
      },
    });

    const result = await searchMessages({ query: "test" });
    const output = JSON.parse(result.content[0].text);
    expect(output.page).toBe("3/25");
    expect(output.total).toBe(500);
    expect(output.pageCount).toBeUndefined();
  });

  it("fetches thread parent with display name and relative time", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [
          {
            ts: "1771574700.000000",
            text: "reply",
            user: "U002",
            username: "alice",
            channel: { id: "C123", name: "general" },
            permalink: "",
            thread_ts: "1771574600.000000",
          },
        ],
        paging: { total: 1, page: 1, pages: 1 },
      },
    });

    mockConversationsReplies.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574600.000000", user: "U001", text: "parent msg" }],
    });

    const result = await searchMessages({ query: "test" });
    const output = JSON.parse(result.content[0].text);

    expect(output.results[0].threadParent).toBeDefined();
    expect(output.results[0].threadParent.user).toBe("alice");
    expect(output.results[0].threadParent.text).toBe("parent msg");
    // threadId has raw ts for API traversal
    expect(output.results[0].threadId).toBe("1771574600.000000");
    // Old thread field is gone
    expect(output.results[0].thread).toBeUndefined();
  });

  it("deduplicates thread parent fetches", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [
          { ts: "1771574700.000000", text: "r1", user: "U001", username: "alice", channel: { id: "C1", name: "g" }, permalink: "", thread_ts: "1771574600.000000" },
          { ts: "1771574800.000000", text: "r2", user: "U002", username: "carol", channel: { id: "C1", name: "g" }, permalink: "", thread_ts: "1771574600.000000" },
        ],
        paging: { total: 2, page: 1, pages: 1 },
      },
    });

    mockConversationsReplies.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574600.000000", user: "U001", text: "parent" }],
    });

    await searchMessages({ query: "test" });
    expect(mockConversationsReplies).toHaveBeenCalledTimes(1);
  });

  it("gracefully handles thread parent fetch failure", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [
          { ts: "1771574700.000000", text: "reply", user: "U001", username: "alice", channel: { id: "C1", name: "g" }, permalink: "", thread_ts: "1771574600.000000" },
        ],
        paging: { total: 1, page: 1, pages: 1 },
      },
    });

    mockConversationsReplies.mockRejectedValue(new Error("API error"));

    const result = await searchMessages({ query: "test" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results[0].threadParent).toBeUndefined();
    expect(result.isError).toBeUndefined();
  });
});

describe("search ID and user format (Phases 2+3)", () => {
  it("search result has id field with raw ts", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [{ ts: "1771574618.875419", text: "x", user: "U001", username: "alice", channel: { id: "C1", name: "g" }, permalink: "" }],
        paging: { total: 1, page: 1, pages: 1 },
      },
    });
    const result = await searchMessages({ query: "test" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results[0].id).toBe("1771574618.875419");
  });

  it("search result user is displayName (userId)", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [{ ts: "1771574618.000000", text: "x", user: "U001", username: "alice", channel: { id: "C1", name: "g" }, permalink: "" }],
        paging: { total: 1, page: 1, pages: 1 },
      },
    });
    const result = await searchMessages({ query: "test" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results[0].user).toBe("alice (U001)");
  });

  it("search result NOT in thread has no threadId", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [{ ts: "1771574618.000000", text: "x", user: "U001", username: "alice", channel: { id: "C1", name: "g" }, permalink: "" }],
        paging: { total: 1, page: 1, pages: 1 },
      },
    });
    const result = await searchMessages({ query: "test" });
    const output = JSON.parse(result.content[0].text);
    expect(output.results[0].threadId).toBeUndefined();
  });
});
