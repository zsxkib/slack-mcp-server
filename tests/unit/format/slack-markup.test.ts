import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanSlackText } from "../../../src/utils/format/slack-markup.js";

// Mock the user cache
vi.mock("../../../src/cache/user-cache.js", () => ({
  getDisplayName: vi.fn(async (userId: string) => {
    const names: Record<string, string> = {
      U001: "alice",
      U002: "carol",
      U003: "dave",
    };
    return names[userId] ?? userId;
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cleanSlackText", () => {
  describe("HTML entities", () => {
    it("decodes &amp; to &", async () => {
      expect(await cleanSlackText("foo &amp; bar")).toBe("foo & bar");
    });

    it("decodes &lt; to <", async () => {
      expect(await cleanSlackText("a &lt; b")).toBe("a < b");
    });

    it("decodes &gt; to >", async () => {
      expect(await cleanSlackText("a &gt; b")).toBe("a > b");
    });

    it("decodes multiple entities in one string", async () => {
      expect(await cleanSlackText("&lt;div&gt; &amp; &lt;/div&gt;")).toBe(
        "<div> & </div>"
      );
    });
  });

  describe("URL links", () => {
    it("converts <URL|text> to [text](URL)", async () => {
      expect(
        await cleanSlackText("<https://example.com|Example>")
      ).toBe("[Example](https://example.com)");
    });

    it("converts bare <URL> to URL", async () => {
      expect(await cleanSlackText("<https://example.com>")).toBe(
        "https://example.com"
      );
    });

    it("handles multiple links in one message", async () => {
      const input = "Check <https://a.com|A> and <https://b.com|B>";
      expect(await cleanSlackText(input)).toBe(
        "Check [A](https://a.com) and [B](https://b.com)"
      );
    });
  });

  describe("user mentions", () => {
    it("resolves <@U001> to @alice", async () => {
      expect(await cleanSlackText("Hey <@U001>!")).toBe("Hey @alice!");
    });

    it("resolves multiple mentions", async () => {
      expect(await cleanSlackText("<@U001> and <@U002>")).toBe(
        "@alice and @carol"
      );
    });

    it("falls back to raw ID for unknown users", async () => {
      expect(await cleanSlackText("<@UUNKNOWN>")).toBe("@UUNKNOWN");
    });
  });

  describe("channel references", () => {
    it("converts <#C123|general> to #general", async () => {
      expect(await cleanSlackText("in <#C123|general>")).toBe("in #general");
    });

    it("handles channel ref without label", async () => {
      expect(await cleanSlackText("<#C123>")).toBe("#C123");
    });
  });

  describe("combined markup", () => {
    it("handles entities + links + mentions together", async () => {
      const input =
        "<@U001> said &amp; shared <https://example.com|link> in <#C1|general>";
      expect(await cleanSlackText(input)).toBe(
        "@alice said & shared [link](https://example.com) in #general"
      );
    });

    it("handles empty string", async () => {
      expect(await cleanSlackText("")).toBe("");
    });

    it("returns plain text unchanged", async () => {
      expect(await cleanSlackText("just plain text")).toBe("just plain text");
    });

    it("handles text with only entities and no links", async () => {
      expect(await cleanSlackText("a &gt; b &amp;&amp; c &lt; d")).toBe(
        "a > b && c < d"
      );
    });
  });
});
