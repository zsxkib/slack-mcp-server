import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveChannelId, reset } from "../../../src/cache/channel-cache.js";

const mockConversationsList = vi.fn();
vi.mock("../../../src/slack/client.js", () => ({
  getSlackClient: () => ({
    conversations: {
      list: mockConversationsList,
    },
  }),
}));

const MOCK_CHANNELS = [
  { id: "C123", name: "general" },
  { id: "C456", name: "random" },
  { id: "C789", name: "studio" },
];

beforeEach(() => {
  reset();
  mockConversationsList.mockReset();
  mockConversationsList.mockResolvedValue({
    ok: true,
    channels: MOCK_CHANNELS,
    response_metadata: { next_cursor: "" },
  });
});

describe("resolveChannelId", () => {
  it('resolves "general" → "C123" (name lookup)', async () => {
    expect(await resolveChannelId("general")).toBe("C123");
  });

  it('resolves "#general" → "C123" (hash prefix stripped)', async () => {
    expect(await resolveChannelId("#general")).toBe("C123");
  });

  it('resolves "General" → "C123" (case insensitive)', async () => {
    expect(await resolveChannelId("General")).toBe("C123");
  });

  it('resolves "C123" → "C123" (ID passthrough)', async () => {
    expect(await resolveChannelId("C123")).toBe("C123");
  });

  it('resolves "nonexistent" → "nonexistent" (fallback to raw input)', async () => {
    expect(await resolveChannelId("nonexistent")).toBe("nonexistent");
  });

  it('resolves "D999" → "D999" (DM ID passthrough)', async () => {
    expect(await resolveChannelId("D999")).toBe("D999");
  });

  it("cache populates only once (multiple calls, one API request)", async () => {
    await resolveChannelId("general");
    await resolveChannelId("random");
    await resolveChannelId("studio");
    expect(mockConversationsList).toHaveBeenCalledTimes(1);
  });

  it("cache handles pagination (multiple pages)", async () => {
    mockConversationsList
      .mockResolvedValueOnce({
        ok: true,
        channels: [{ id: "C001", name: "page1" }],
        response_metadata: { next_cursor: "cursor1" },
      })
      .mockResolvedValueOnce({
        ok: true,
        channels: [{ id: "C002", name: "page2" }],
        response_metadata: { next_cursor: "" },
      });

    expect(await resolveChannelId("page1")).toBe("C001");
    expect(await resolveChannelId("page2")).toBe("C002");
    expect(mockConversationsList).toHaveBeenCalledTimes(2);
  });

  it("cache handles API failure gracefully (falls back to passthrough)", async () => {
    mockConversationsList.mockRejectedValue(new Error("network error"));
    expect(await resolveChannelId("general")).toBe("general");
  });

  it("reset() clears cache, next call repopulates", async () => {
    await resolveChannelId("general");
    expect(mockConversationsList).toHaveBeenCalledTimes(1);
    reset();
    await resolveChannelId("general");
    expect(mockConversationsList).toHaveBeenCalledTimes(2);
  });

  it("empty workspace (no channels) → passthrough for all inputs", async () => {
    mockConversationsList.mockResolvedValue({
      ok: true,
      channels: [],
      response_metadata: { next_cursor: "" },
    });
    expect(await resolveChannelId("general")).toBe("general");
  });
});
