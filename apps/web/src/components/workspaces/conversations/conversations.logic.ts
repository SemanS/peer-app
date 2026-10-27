import { PEER_HARVEST_CONVERSATIONS_MAX, type PeerConversationReport } from "@t3tools/contracts";

/**
 * The conversations a person is looking at, as text kontext reads for what the project should keep:
 * each one's title, the latest request and the agent's reply, newest first, cut to what the Hub
 * accepts. Conversations with neither are left out; null when none has any.
 */
export function conversationExcerpts(
  items: PeerConversationReport["items"],
  max = PEER_HARVEST_CONVERSATIONS_MAX,
): { readonly text: string; readonly read: number } | null {
  const parts: string[] = [];
  let length = 0;
  for (const item of items) {
    if (item.request === null && item.response === null) continue;
    const part = [
      `## ${item.title}`,
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
