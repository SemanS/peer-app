import { PEER_HARVEST_CONVERSATIONS_MAX, type PeerConversationReport } from "@t3tools/contracts";

import { plainSummary } from "../knowledge/knowledge.logic";

type Item = PeerConversationReport["items"][number];

/**
 * Text a provider puts before the person's words (Codex's injected AGENTS.md, a tag block), which
 * becomes a thread's title when nobody named it and says nothing about the work.
 */
const INJECTED =
  /^(?:#\s*)?(?:AGENTS\.md|CLAUDE\.md)\b|^<[a-z_-]+>|^#\s*(?:instructions|environment)\b/i;
const injected = (text: string) => INJECTED.test(text.trim());

/**
 * What a conversation was about, in words: its title, unless the title is injected instructions;
 * then the first sentence of its latest request, or of the agent's reply.
 */
export function conversationTitle(item: Item): string {
  if (item.title.trim() !== "" && !injected(item.title)) return item.title.trim();
  for (const text of [item.request, item.response]) {
    if (text === null || injected(text)) continue;
    const words = plainSummary(text, 80);
    if (words !== "") return words;
  }
  return "Untitled conversation";
}

/** The agent's reply in a sentence or two: what it says it did. */
export const replySummary = (item: Item) =>
  item.response === null ? null : plainSummary(item.response, 200);

/**
 * The conversations a person is looking at, as text kontext reads for what the project should keep:
 * each one's title, the latest request and the agent's reply, newest first, cut to what the Hub
 * accepts. Conversations with neither are left out; null when none has any.
 */
export function conversationExcerpts(
  items: ReadonlyArray<Item>,
  max = PEER_HARVEST_CONVERSATIONS_MAX,
): { readonly text: string; readonly read: number } | null {
  const parts: string[] = [];
  let length = 0;
  for (const item of items) {
    if (item.request === null && item.response === null) continue;
    const part = [
      `## ${conversationTitle(item)}`,
      item.request === null ? null : `Request: ${item.request}`,
      item.response === null ? null : `Agent reply: ${item.response}`,
    ]
      .filter((line) => line !== null)
      .join("\n");
    const added = part.length + (parts.length === 0 ? 0 : 2);
    if (length + added > max) break;
    parts.push(part);
    length += added;
  }
  return parts.length === 0 ? null : { text: parts.join("\n\n"), read: parts.length };
}
