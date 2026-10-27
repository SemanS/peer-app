import type { PeerConversationReport } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { conversationExcerpts } from "./conversations.logic";

type Item = PeerConversationReport["items"][number];
const item = (id: string, request: string | null, response: string | null): Item => ({
  id,
  threadId: id,
  title: `Conversation ${id}`,
  status: "done",
  archived: false,
  updatedAt: null,
  request,
  response,
  responseAt: null,
  messages: 2,
  availability: "available",
  truncated: false,
});

describe("conversationExcerpts", () => {
  it("writes each conversation's request and reply and skips empty ones", () => {
    const result = conversationExcerpts([
      item("a", "Move prices to cents", "Done; prices are integers now."),
      item("b", null, null),
      item("c", null, "Found the cache is per worker."),
    ]);
    expect(result).toEqual({
      read: 2,
      text:
        "## Conversation a\nRequest: Move prices to cents\nAgent reply: Done; prices are integers now.\n\n" +
        "## Conversation c\nAgent reply: Found the cache is per worker.",
    });
  });

  it("stops before the limit instead of cutting a conversation", () => {
    const result = conversationExcerpts(
      [item("a", "x".repeat(40), null), item("b", "y", null)],
      70,
    );
    expect(result?.read).toBe(1);
    expect(conversationExcerpts([item("a", null, null)])).toBeNull();
  });
});
