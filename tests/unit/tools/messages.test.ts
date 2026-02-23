import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConversationsHistory = vi.fn();
const mockConversationsReplies = vi.fn();
const mockUsersList = vi.fn();

vi.mock("../../../src/slack/client.js", () => ({
  getSlackClient: () => ({
    conversations: {
      history: mockConversationsHistory,
      replies: mockConversationsReplies,
    },
    users: {
      list: mockUsersList,
    },
  }),
}));

const mockResolveChannelId = vi.fn();
vi.mock("../../../src/cache/channel-cache.js", () => ({
  resolveChannelId: (...args: unknown[]) => mockResolveChannelId(...args),
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
import "../../../src/tools/messages.js";
import { reset as resetUserCache } from "../../../src/cache/user-cache.js";

const handlers = (server as unknown as { _handlers: Map<string, Function> })._handlers;
const getChannelHistory = handlers.get("get_channel_history")!;
const getThreadReplies = handlers.get("get_thread_replies")!;

beforeEach(() => {
  vi.clearAllMocks();
  resetUserCache();
  mockResolveChannelId.mockImplementation((id: string) => Promise.resolve(id));
  mockUsersList.mockResolvedValue({
    ok: true,
    members: [
      { id: "U001", name: "alice", real_name: "Alice Smith", profile: { display_name: "alice" } },
      { id: "U002", name: "carol", real_name: "Carol S", profile: { display_name: "carol" } },
    ],
    response_metadata: { next_cursor: "" },
  });
});

describe("get_channel_history formatting", () => {
  it("returns human-readable time, separate id, user with ID, compact reactions", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [
        {
          ts: "1771574618.875419",
          user: "U001",
          text: "Hello &amp; welcome",
          reactions: [{ name: "tada", count: 3, users: ["U001", "U002", "U003"] }],
        },
      ],
      response_metadata: {},
    });

    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    const msg = output.messages[0];

    // Time is human-readable only — no embedded ts
    expect(msg.time).not.toContain("(");
    expect(msg.time).not.toMatch(/\d+\.\d+/);
    // Separate id field has raw ts
    expect(msg.id).toBe("1771574618.875419");
    // User is "displayName (userId)" format
    expect(msg.user).toBe("alice (U001)");
    // Old thread field is gone
    expect(msg.thread).toBeUndefined();
    // No separate ts, userId, or username fields
    expect(msg.ts).toBeUndefined();
    expect(msg.userId).toBeUndefined();
    expect(msg.username).toBeUndefined();
    // Reactions compact
    expect(msg.reactions).toEqual({ tada: 3 });
    // Entities cleaned
    expect(msg.text).toBe("Hello & welcome");
  });

  it("strips null thread and empty reactions", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [
        { ts: "1771574618.000000", user: "U001", text: "simple", reactions: [] },
      ],
      response_metadata: {},
    });

    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);

    expect(output.messages[0].thread).toBeUndefined();
    expect(output.messages[0].replyCount).toBeUndefined();
    expect(output.messages[0].reactions).toBeUndefined();
  });

  it("resolves @mentions and converts links in text", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [
        {
          ts: "1771574618.000000",
          user: "U001",
          text: "Hey <@U002>, see <https://example.com|this> in <#C456|general>",
          reactions: [],
        },
      ],
      response_metadata: {},
    });

    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);

    expect(output.messages[0].text).toBe(
      "Hey @carol, see [this](https://example.com) in #general"
    );
  });

  it("includes threadId with raw ts when message is in a thread", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [
        {
          ts: "1771574700.000000",
          user: "U001",
          text: "reply",
          thread_ts: "1771574600.000000",
          reactions: [],
        },
      ],
      response_metadata: {},
    });

    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);

    expect(output.messages[0].threadId).toBe("1771574600.000000");
    expect(output.messages[0].thread).toBeUndefined();
  });
});

describe("channel name resolution (Phase 1)", () => {
  it('get_channel_history with channel name "general" → resolves to ID', async () => {
    mockResolveChannelId.mockResolvedValue("C123");
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.000000", user: "U001", text: "hi" }],
      response_metadata: {},
    });
    await getChannelHistory({ channel_id: "general" });
    expect(mockResolveChannelId).toHaveBeenCalledWith("general");
    expect(mockConversationsHistory).toHaveBeenCalledWith(expect.objectContaining({ channel: "C123" }));
  });

  it('get_channel_history with channel ID "C123" → passes through', async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.000000", user: "U001", text: "hi" }],
      response_metadata: {},
    });
    await getChannelHistory({ channel_id: "C123" });
    expect(mockResolveChannelId).toHaveBeenCalledWith("C123");
  });

  it("get_thread_replies with channel name → resolves correctly", async () => {
    mockResolveChannelId.mockResolvedValue("C123");
    mockConversationsReplies.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.000000", user: "U001", text: "reply" }],
      response_metadata: {},
    });
    await getThreadReplies({ channel_id: "general", thread_ts: "1771574600.000000" });
    expect(mockResolveChannelId).toHaveBeenCalledWith("general");
    expect(mockConversationsReplies).toHaveBeenCalledWith(expect.objectContaining({ channel: "C123" }));
  });

  it("channel resolution failure → returns MCP error", async () => {
    mockResolveChannelId.mockResolvedValue("nonexistent");
    mockConversationsHistory.mockRejectedValue(Object.assign(new Error("channel_not_found"), { code: "slack_webapi_platform_error", data: { error: "channel_not_found" } }));
    const result = await getChannelHistory({ channel_id: "nonexistent" });
    expect(result.isError).toBe(true);
  });
});

describe("text:undefined crash fix (Phase 0)", () => {
  it("message with text: undefined → output has text: ''", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.000000", user: "U001", text: undefined }],
      response_metadata: {},
    });
    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    expect(output.messages[0].text).toBe("");
  });

  it("message with text: '' → output has text: ''", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.000000", user: "U001", text: "" }],
      response_metadata: {},
    });
    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    expect(output.messages[0].text).toBe("");
  });

  it("message with text: null → output has text: ''", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.000000", user: "U001", text: null }],
      response_metadata: {},
    });
    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    expect(output.messages[0].text).toBe("");
  });

  it("mixed batch: normal messages + text-less messages → all format", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [
        { ts: "1771574618.000000", user: "U001", text: "normal" },
        { ts: "1771574619.000000", user: "U001", text: undefined },
        { ts: "1771574620.000000", user: "U002", text: "" },
      ],
      response_metadata: {},
    });
    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    expect(output.messages).toHaveLength(3);
    expect(output.messages[0].text).toBe("normal");
    expect(output.messages[1].text).toBe("");
    expect(output.messages[2].text).toBe("");
  });

  it("file-share message (has no text) → text: ''", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.000000", user: "U001", files: [{ id: "F1" }] }],
      response_metadata: {},
    });
    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    expect(output.messages[0].text).toBe("");
  });

  it("message with only blocks (no text field) → text: ''", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.000000", user: "U001", blocks: [{ type: "section" }] }],
      response_metadata: {},
    });
    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    expect(output.messages[0].text).toBe("");
  });

  it("bot message with no text → text: ''", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.000000", bot_id: "B001", text: undefined }],
      response_metadata: {},
    });
    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    expect(output.messages[0].text).toBe("");
  });
});

describe("get_thread_replies formatting", () => {
  it("applies same pipeline", async () => {
    mockConversationsReplies.mockResolvedValue({
      ok: true,
      messages: [
        {
          ts: "1771574618.000000",
          user: "U002",
          text: "reply &lt;here&gt;",
          thread_ts: "1771574600.000000",
          reactions: [{ name: "ok", count: 1, users: ["U001"] }],
        },
      ],
      response_metadata: {},
    });

    const result = await getThreadReplies({ channel_id: "C123", thread_ts: "1771574600.000000" });
    const output = JSON.parse(result.content[0].text);

    expect(output.messages[0].user).toBe("carol (U002)");
    expect(output.messages[0].text).toBe("reply <here>");
    expect(output.messages[0].reactions).toEqual({ ok: 1 });
  });
});

describe("message ID and user ID format (Phases 2+3)", () => {
  it("message has id field with raw ts value", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.875419", user: "U001", text: "hi" }],
      response_metadata: {},
    });
    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    expect(output.messages[0].id).toBe("1771574618.875419");
  });

  it("message has time field with human-readable only (no parens)", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.875419", user: "U001", text: "hi" }],
      response_metadata: {},
    });
    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    expect(output.messages[0].time).not.toContain("(");
    expect(output.messages[0].time).not.toMatch(/\d+\.\d+/);
  });

  it("message NOT in a thread has no threadId", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.000000", user: "U001", text: "hi" }],
      response_metadata: {},
    });
    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    expect(output.messages[0].threadId).toBeUndefined();
  });

  it("user field is displayName (userId) format", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.000000", user: "U001", text: "hi" }],
      response_metadata: {},
    });
    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    expect(output.messages[0].user).toBe("alice (U001)");
  });

  it("unknown user falls back to raw ID", async () => {
    mockConversationsHistory.mockResolvedValue({
      ok: true,
      messages: [{ ts: "1771574618.000000", user: "U999", text: "hi" }],
      response_metadata: {},
    });
    const result = await getChannelHistory({ channel_id: "C123" });
    const output = JSON.parse(result.content[0].text);
    expect(output.messages[0].user).toBe("U999");
  });
});
