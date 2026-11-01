import type { PeerConversationReport } from "@t3tools/contracts";

type Item = PeerConversationReport["items"][number];

/** Words a heading only names a part with; a summary starts after them. */
const SECTION_HEADING =
  /^#{1,6}\s+(?:overview|summary|context|background|description|decision|rationale|details|notes|why|what)\b:?\s*/i;

/**
 * Markdown as plain prose people read: headings, code marks, links, emphasis and list marks
 * removed, cut at a sentence or word near `max`. Agents keep the Markdown; this is only its gist.
 */
export function plainSummary(markdown: string, max = 220): string {
  const text = markdown
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    // A heading on its own line names a part; the prose under it says what it holds.
    .filter((line, _index, lines) => !(/^#{1,6}\s/.test(line) && lines.length > 1))
    .join(" ")
    .replace(SECTION_HEADING, "")
    .replace(/#{1,6}\s+/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/(^|\s)(?:[-*+]|\d+[.)])\s+/g, "$1")
    .replace(/(^|\s)>\s+/g, "$1")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = cut.search(/[.!?](?=\s)[^.!?]*$/);
  if (sentence >= max / 2) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(" ");
  return `${(word >= max / 2 ? cut.slice(0, word) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}

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
