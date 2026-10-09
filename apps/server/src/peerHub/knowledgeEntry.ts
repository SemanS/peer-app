/**
 * knowledgeEntry — one entry of a project's reviewed knowledge (kontext, `.ai/` in its
 * repository) as its markdown file holds it: frontmatter fields, then the text. The knowledge
 * plugin indexes these entries for agents, and Peer Memory imports them; both read them here.
 *
 * @module peerHub/knowledgeEntry
 */
import { block, plain } from "./peerText.ts";

/** One entry of a project's knowledge. */
export interface KnowledgeEntry {
  readonly id: string;
  /** decision, convention, learning or incident. */
  readonly kind: string;
  readonly title: string;
  /** accepted, proposed, superseded; entries of the kinds without one have none. */
  readonly status: string | undefined;
  readonly date: string | undefined;
  readonly summary: string;
  readonly tags: ReadonlyArray<string>;
  /** The paths and globs it governs, relative to the repository. */
  readonly paths: ReadonlyArray<string>;
  /** Where the entry is, relative to the repository (`.ai/decisions/….md`). */
  readonly file: string;
  /** The start of its text. */
  readonly body: string;
}

const KINDS = ["decision", "convention", "learning", "incident"] as const;

/** A kontext entry's frontmatter fields and body. */
export function entryParts(markdown: string): {
  readonly fields: Readonly<Record<string, string>>;
  readonly body: string;
} {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(markdown);
  if (match === null) return { fields: {}, body: markdown };
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const field = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (field?.[1] !== undefined) fields[field[1]] = (field[2] ?? "").replace(/^"|"$/g, "");
  }
  return { fields, body: (match[2] ?? "").trim() };
}

/** A frontmatter list: `[a, b]` or `a, b`. */
export function parseList(value: string | undefined): string[] {
  const inner = (value ?? "").trim().replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter((item) => item !== "");
}

/** How many paths and tags an entry may name, how long one may be, how much of its text is kept. */
const MAX_LISTED = 12;
export const MAX_PATTERN = 200;
const MAX_BODY = 6000;

/**
 * The entry a markdown file holds, or undefined when it has no id and title. What reaches an agent
 * (kind, status, date, title, summary) is made plain and short here: the entry is text somebody
 * committed, and it is read by every agent that works where it applies.
 */
export function parseEntry(markdown: string, file: string): KnowledgeEntry | undefined {
  const { fields, body } = entryParts(markdown);
  const id = fields.id;
  const title = plain(fields.title ?? "", 200);
  if (id === undefined || !/^[\p{L}\p{N}_.:-]{1,160}$/u.test(id) || title === "") return undefined;
  const folder = file.split("/").at(-2) ?? "";
  const named = KINDS.find((candidate) => candidate === fields.kind);
  const kind = named ?? KINDS.find((candidate) => `${candidate}s` === folder) ?? "learning";
  const status = /^[a-z][a-z-]{0,19}$/i.test(fields.status ?? "") ? fields.status : undefined;
  const date = /^\d{4}-\d{2}-\d{2}/.exec(fields.date ?? "")?.[0];
  return {
    id,
    kind,
    title,
    status,
    date,
    summary: plain(fields.summary ?? "", 400),
    tags: parseList(fields.tags)
      .slice(0, MAX_LISTED)
      .map((tag) => plain(tag, 40)),
    paths: parseList(fields.paths)
      .slice(0, MAX_LISTED)
      .filter((pattern) => pattern.length <= MAX_PATTERN),
    file,
    body: block(body, MAX_BODY),
  };
}
