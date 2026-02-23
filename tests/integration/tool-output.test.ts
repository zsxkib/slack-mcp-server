import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConversationsHistory = vi.fn();
const mockConversationsReplies = vi.fn();
const mockSearchMessages = vi.fn();
const mockUsersList = vi.fn();

vi.mock("../../src/slack/client.js", () => ({
  getSlackClient: () => ({
    conversations: {
      history: mockConversationsHistory,
      replies: mockConversationsReplies,
    },
    search: { messages: mockSearchMessages },
    users: { list: mockUsersList },
  }),
  isSearchAvailable: () => true,
}));

const mockResolveChannelId = vi.fn();
vi.mock("../../src/cache/channel-cache.js", () => ({
  resolveChannelId: (...args: unknown[]) => mockResolveChannelId(...args),
}));

vi.mock("../../src/server.js", () => {
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

import { server } from "../../src/server.js";
import "../../src/tools/messages.js";
import "../../src/tools/search.js";
import { reset as resetUserCache } from "../../src/cache/user-cache.js";

const handlers = (server as unknown as { _handlers: Map<string, Function> })._handlers;

beforeEach(() => {
  vi.clearAllMocks();
  resetUserCache();
  mockResolveChannelId.mockImplementation((id: string) => Promise.resolve(id));
  mockUsersList.mockResolvedValue({
    ok: true,
    members: [
      { id: "U001", name: "alice", real_name: "Alice Smith", profile: { display_name: "alice" } },
      { id: "U002", name: "bob", real_name: "Bob Jones", profile: { display_name: "bob" } },
    ],
    response_metadata: { next_cursor: "" },
  });
});

describe("text:undefined crash fix (Phase 0 integration)", () => {
  it("get_thread_replies with mixed content (text + file-only + bot) → no crash", async () => {
    mockConversationsReplies.mockResolvedValue({
      ok: true,
      messages: [
        { ts: "1771574600.000000", user: "U001", text: "parent message" },
        { ts: "1771574700.000000", user: "U002", text: undefined, files: [{ id: "F1" }] },
        { ts: "1771574800.000000", bot_id: "B001", text: undefined },
      ],
      response_metadata: {},
    });

    const handler = handlers.get("get_thread_replies")!;
    const result = await handler({ channel_id: "C123", thread_ts: "1771574600.000000" });
    expect(result.isError).toBeUndefined();
    const output = JSON.parse(result.content[0].text);
    expect(output.messages).toHaveLength(3);
    expect(output.messages[0].text).toBe("parent message");
    expect(output.messages[1].text).toBe("");
    expect(output.messages[2].text).toBe("");
  });

  it("search_messages result with text-less match → no crash", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [{ ts: "1771574618.000000", text: undefined, user: "U001", username: "alice", channel: { id: "C1", name: "general" }, permalink: "" }],
        paging: { total: 1, page: 1, pages: 1 },
      },
    });
    const handler = handlers.get("search_messages")!;
    const result = await handler({ query: "test" });
    expect(result.isError).toBeUndefined();
    const output = JSON.parse(result.content[0].text);
    expect(output.results[0].text).toBe("");
  });

  it("full JSON output has no undefined values (round-trip test)", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [
        { ts: "1771574618.000000", user: "U001", text: undefined },
        { ts: "1771574619.000000", user: "U002", text: "normal" },
      ],
      response_metadata: {},
    });
    const handler = handlers.get("get_channel_history")!;
    const result = await handler({ channel_id: "C123" });
    const json = result.content[0].text;
    expect(json).not.toContain("undefined");
    const parsed = JSON.parse(json);
    const reparsed = JSON.parse(JSON.stringify(parsed));
    expect(reparsed).toEqual(parsed);
  });
});

describe("end-to-end output shape", () => {
  it("channel history: clean, combined fields, no nulls", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [
        {
          ts: "1771574618.875419",
          user: "U001",
          text: "Hey <@U002>, check <https://acme.example.com|Acme> &amp; <#C456|general>",
          reactions: [{ name: "rocket", count: 2, users: ["U001", "U002"] }],
        },
        {
          ts: "1771574700.000000",
          user: "U002",
          text: "Plain message",
          reactions: [],
        },
      ],
      response_metadata: { next_cursor: "" },
    });

    const handler = handlers.get("get_channel_history")!;
    const result = await handler({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);

    const msg1 = output.messages[0];
    // Time is human-readable only
    expect(msg1.time).not.toContain("(");
    // Separate id field
    expect(msg1.id).toBe("1771574618.875419");
    // User with ID
    expect(msg1.user).toBe("alice (U001)");
    // Cleaned text
    expect(msg1.text).toBe("Hey @bob, check [Acme](https://acme.example.com) & #general");
    // Compact reactions
    expect(msg1.reactions).toEqual({ rocket: 2 });
    // No old fields
    expect(msg1.ts).toBeUndefined();
    expect(msg1.userId).toBeUndefined();

    const msg2 = output.messages[1];
    expect(msg2.user).toBe("bob (U002)");
    expect(msg2.reactions).toBeUndefined();

    // No nulls or empty arrays anywhere
    const json = JSON.stringify(output);
    expect(json).not.toContain(":null");
    expect(json).not.toContain(":[]");
  });

  it("search: merged channel, thread parent, compact pagination", async () => {
    mockSearchMessages.mockResolvedValue({
      ok: true,
      messages: {
        matches: [
          {
            ts: "1771574700.000000",
            text: "Found this &lt;interesting&gt;",
            user: "U002",
            username: "bob",
            channel: { id: "D999", name: "U001" },
            permalink: "https://slack.com/long/permalink/here",
            thread_ts: "1771574600.000000",
          },
        ],
        paging: { total: 125, page: 1, pages: 63 },
      },
    });

    mockConversationsReplies.mockResolvedValue({
      ok: true,
      messages: [
        { ts: "1771574600.000000", user: "U001", text: "Original starter" },
      ],
    });

    const handler = handlers.get("search_messages")!;
    const result = await handler({ query: "interesting" });
    const output = JSON.parse(result.content[0].text);

    const r = output.results[0];
    // Merged channel with DM resolution
    expect(r.channel).toBe("DM: alice (D999)");
    // User with ID
    expect(r.user).toBe("bob (U002)");
    // Time is human-readable only
    expect(r.time).not.toContain("(");
    // Separate id field
    expect(r.id).toBe("1771574700.000000");
    // Cleaned text
    expect(r.text).toBe("Found this <interesting>");
    // Thread parent with display names only (uses getDisplayName)
    expect(r.threadParent.user).toBe("alice");
    expect(r.threadParent.text).toBe("Original starter");
    // threadId has raw ts for API traversal
    expect(r.threadId).toBe("1771574600.000000");
    // Old thread field is gone
    expect(r.thread).toBeUndefined();
    // Killed fields
    expect(r.permalink).toBeUndefined();
    expect(r.username).toBeUndefined();
    expect(r.channelId).toBeUndefined();
    expect(r.channelName).toBeUndefined();
    // Compact pagination
    expect(output.page).toBe("1/63");
    expect(output.total).toBe(125);
    expect(output.pageCount).toBeUndefined();
  });
});

describe("ID separation and user IDs (Phases 2+3 integration)", () => {
  it("no field in output matches embedded timestamp pattern", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [
        { ts: "1771574618.875419", user: "U001", text: "test", thread_ts: "1771574600.000000" },
      ],
      response_metadata: {},
    });
    const handler = handlers.get("get_channel_history")!;
    const result = await handler({ channel_id: "C123" });
    const json = result.content[0].text;
    // No embedded timestamps in parens (old format)
    expect(json).not.toMatch(/\(\d+\.\d+\)/);
  });
});
