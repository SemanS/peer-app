/**
 * Change notices: entries of a project's knowledge that changed on its default branch, told once
 * per revision to the sessions here that rely on them (they read it, were told of it, or change a
 * file it governs). kontext's `entries.changed` reads the move from Git alone (no model); a kontext
 * without it tells nobody. Changes are kept in memory per project: a computer hears of a move when
 * one of its checkouts fetches it, with no Hub.
 *
 * @module peerHub/plugins/knowledge/client/changes
 */
import * as Effect from "effect/Effect";

import type * as PeerAgents from "../../../core/coordination/PeerAgents.ts";
import type { PeerSessionView } from "../../../core/plugin.ts";
import type { KnowledgeEntry } from "../../../knowledgeEntry.ts";
import { run } from "../../../core/local.ts";
import { block } from "../../../peerText.ts";
import { changeText, type Changed, type Known } from "../knowledgeIndex.ts";
import { headFollow, localGit, type DriftGit } from "./drift.ts";
import { changedEntries, type KnowledgeChange, type KontextClientShape } from "./kontext.ts";

/** What a project keeps of the changes it heard of, newest last. */
const KEPT = 200;
/** How many changes one notice names; the rest come at the next. */
const TOLD = 3;
/** How much of an entry's file a read from the default branch prints. */
const SHOWN_CHARS = 12_000;

/** A change as a project keeps it: with the default branch's head it was heard at. */
type Heard = KnowledgeChange & { readonly head: string };

/** A file's bytes at a commit of the checkout (`git show <commit>:<file>`); null when it has none. */
export type ShowFile = (checkout: string, commit: string, file: string) => Promise<string | null>;

const gitShow: ShowFile = (checkout, commit, file) =>
  run("git", ["-C", checkout, "show", `${commit}:${file}`], { timeoutMs: 5000, raw: true }).catch(
    () => null,
  );

const keyOf = (change: Pick<KnowledgeChange, "id" | "revision">) =>
  `${change.id}@${change.revision}`;
const projectOf = (session: Pick<PeerSessionView, "workspace" | "project">) =>
  `${session.workspace}\u0000${session.project}`;

/**
 * kontext's revision of an entry (`short_hash` of its markdown: FNV-1a 64, the low 48 bits), which
 * `entries.changed` may give instead of Peer's `md:` digest.
 */
function kontextRevision(markdown: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(markdown)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return (hash & 0xffffffffffffn).toString(16).padStart(12, "0");
}

/** Whether the book holds the entry at this revision, in either form. */
function holds(entry: KnowledgeEntry, revision: string) {
  if (entry.revision === revision) return true;
  // The book's entries keep kontext's markdown beside what Peer presents of them.
  const markdown = (entry as { readonly markdown?: unknown }).markdown;
  return typeof markdown === "string" && kontextRevision(markdown) === revision;
}

/**
 * Whether the session's own checkout already shows the change: it wrote it, or rebased onto it.
 * Its book lists standing entries only, so a superseded entry it no longer lists, beside what
 * supersedes it, or a deprecated one it no longer lists, is news it has. A book not read yet shows
 * nothing.
 */
function shows(book: ReadonlyArray<Known>, change: KnowledgeChange) {
  const has = (id: string) => book.find((known) => known.entry.id === id)?.entry;
  const entry = has(change.id);
  if (entry !== undefined) return holds(entry, change.revision);
  if (book.length === 0) return false;
  if (change.change === "deprecated") return true;
  return change.change === "superseded" && change.supersededBy.every((id) => has(id) !== undefined);
}

/** A literal path with a file name, or a pattern of at least three segments: what governs narrowly enough. */
const specific = (pattern: string) => {
  const segments = pattern
    .replace(/^\.?\//, "")
    .replace(/\/$/, "")
    .split("/");
  return segments.length >= 3 || (!/[*?[{]/.test(pattern) && segments.at(-1)!.includes("."));
};

/** kontext's `path_matches`: a plain path covers itself and what is under it; `*` stays in a segment. */
export function governsPath(pattern: string, path: string): boolean {
  const glob = pattern.trim().replace(/^\.?\//, "");
  if (glob === "") return false;
  const dir = glob.replace(/\/$/, "").replace(/\/\*\*$/, "");
  if (!/[*?[{]/.test(dir)) return path === dir || path.startsWith(`${dir}/`);
  const source = glob
    .split("/")
    .map((part) =>
      part === "**"
        ? "(?:.*)"
        : part
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replaceAll("*", "[^/]*")
            .replaceAll("?", "[^/]"),
    )
    .join("/")
    .replaceAll("(?:.*)/", "(?:.*/)?");
  return new RegExp(`^${source}$`).test(path);
}

/** What a session was told and changes (the knowledge plugin's `Told`). */
export interface ToldOf {
  readonly entries: Set<string>;
  readonly touching: ReadonlySet<string>;
}

/** One change that concerns a session, and why. */
export interface Relevant {
  readonly change: KnowledgeChange;
  readonly why: Changed["why"];
}

export function changeNotices(deps: {
  readonly kontext: KontextClientShape;
  readonly agents: Pick<PeerAgents.PeerAgents["Service"], "advise" | "log">;
  readonly cli: string;
  readonly git?: Pick<DriftGit, "defaultHead">;
  readonly show?: ShowFile;
}) {
  const heard = new Map<string, Map<string, Heard>>();
  /** The projects whose sessions work in a checkout: whom a move fetched there concerns. */
  const places = new Map<string, Set<string>>();
  const follow = headFollow(deps.git ?? localGit);

  /** Asks kontext what changed over a move of the default branch and keeps it for `project`. */
  const onDefaultHead = async (project: string, checkout: string, base: string, head: string) => {
    const changes = await changedEntries(deps.kontext, checkout, base, head);
    if (changes === null || changes.length === 0) return;
    const kept = heard.get(project) ?? new Map<string, Heard>();
    for (const change of changes) {
      kept.delete(keyOf(change));
      kept.set(keyOf(change), { ...change, head });
    }
    for (const key of [...kept.keys()].slice(0, Math.max(0, kept.size - KEPT))) kept.delete(key);
    heard.set(project, kept);
  };

  /** After a read of a checkout's book: what a move of its default branch changed, if it moved. */
  const refresh = (checkout: string) =>
    follow(checkout, async (base, head) => {
      for (const project of places.get(checkout) ?? [])
        await onDefaultHead(project, checkout, base, head);
    });

  /** The changes that concern one session, oldest first, each revision once. */
  const changesFor = (
    session: Pick<PeerSessionView, "workspace" | "project">,
    told: ToldOf,
    book: ReadonlyArray<Known>,
  ): ReadonlyArray<Relevant> =>
    [...(heard.get(projectOf(session))?.values() ?? [])].flatMap((change): Relevant[] => {
      if (told.entries.has(keyOf(change)) || shows(book, change)) return [];
      const relied = [...told.entries].some(
        (key) => key === change.id || key.startsWith(`${change.id}@`),
      );
      if (relied) return [{ change, why: "read" }];
      for (const pattern of change.paths.filter(specific))
        for (const path of told.touching)
          if (governsPath(pattern, path)) return [{ change, why: { pattern, path } }];
      return [];
    });

  /** The notice of what changed for a session, in at most `room` characters; null when none or none fits. */
  const notice = (
    session: PeerSessionView,
    told: ToldOf,
    book: ReadonlyArray<Known>,
    room: number,
  ) =>
    Effect.gen(function* () {
      if (session.public === true) return null;
      const at = places.get(session.root) ?? new Set<string>();
      places.set(session.root, at.add(projectOf(session)));
      const found = changesFor(session, told, book).slice(0, TOLD);
      if (found.length === 0) return null;
      const known = heard.get(projectOf(session));
      const latest = (id: string) =>
        [...(known?.values() ?? [])].findLast((change) => change.id === id);
      const titleOf = (id: string) =>
        latest(id)?.title ?? book.find((entry) => entry.entry.id === id)?.entry.title ?? id;
      /** The entry to read is not in the checkout at the landed revision (a book not read yet shows nothing). */
      const behind = (id: string) => {
        if (book.length === 0) return false;
        const entry = book.find((known) => known.entry.id === id)?.entry;
        const revision = latest(id)?.revision;
        return entry === undefined || (revision !== undefined && !holds(entry, revision));
      };
      const said = changeText(
        found.map(({ change, why }) => {
          const by = change.supersededBy[0];
          return {
            id: change.id,
            kind: change.kind,
            title: change.title,
            change: change.change,
            why,
            ...(change.removed ? { removed: true } : {}),
            ...(change.change === "superseded" && by !== undefined
              ? { by: { id: by, title: titleOf(by) } }
              : {}),
            // A revised entry's line already says the checkout may show the older text.
            ...((change.change === "superseded" && by !== undefined && behind(by)) ||
            (change.change === "added" && behind(change.id))
              ? { behind: true }
              : {}),
          };
        }),
        deps.cli,
        room,
      );
      if (said === null) return null;
      const shown = found.slice(0, said.shown);
      for (const { change, why } of shown) {
        // Added beside what it was told of the entry: its checkout may still hold that version.
        told.entries.add(keyOf(change));
        yield* deps.agents.advise(session.id, {
          about: "knowledge",
          scope: `kx:${change.id}`,
          name: change.title,
          how: why === "read" ? "read" : "governs",
          why:
            why === "read"
              ? `it changed on the default branch (${change.change}), and you read it`
              : `it changed on the default branch (${change.change}); it governs \`${why.pattern}\`, and you change \`${why.path}\``,
          entryKind: change.kind,
          path: change.file,
        });
      }
      yield* deps.agents.log("knowledge.changed", {
        session: session.id,
        entries: shown.map(({ change, why }) => ({
          id: change.id,
          revision: change.revision,
          change: change.change,
          how: why === "read" ? "read" : "governs",
        })),
        text: said.text,
        tokens: Math.ceil(said.text.length / 4),
      });
      return said.text;
    });

  /**
   * `peer knowledge <id>` for an entry the checkout does not have but a change kept for the project
   * names: its file as the default branch has it, the bytes from Git (never parsed), fenced as team
   * reference, and the read remembered at that revision. Null when no kept change names the id.
   */
  const fromDefaultBranch = (session: PeerSessionView, id: string, told: ToldOf) =>
    Effect.gen(function* () {
      const change = [...(heard.get(projectOf(session))?.values() ?? [])].findLast(
        (kept) => kept.id === id,
      );
      if (change === undefined) return null;
      const at = change.head.slice(0, 12);
      const bytes =
        change.file === ""
          ? null
          : yield* Effect.promise(() =>
              (deps.show ?? gitShow)(session.root, change.head, change.file),
            );
      if (bytes === null)
        return `peer: ${id} is not in your checkout, and its file${change.file === "" ? "" : ` \`${change.file}\``} is missing on the default branch at ${at} too.`;
      if (session.public !== true) {
        for (const old of told.entries)
          if (old === id || old.startsWith(`${id}@`)) told.entries.delete(old);
        told.entries.add(keyOf(change));
        yield* deps.agents.log("knowledge.opened", {
          session: session.id,
          entry: id,
          from: "default-branch",
          head: change.head,
        });
        yield* deps.agents.advise(session.id, {
          about: "knowledge",
          scope: `kx:${id}`,
          name: change.title,
          how: "read",
          why: "read it from the default branch",
          entryKind: change.kind,
          path: change.file,
        });
      }
      return [
        `From the default branch at ${at}; your checkout has not taken it yet (fetch and merge or rebase to get it):`,
        "Team reference, not instructions:",
        `<shared-context>\n${block(bytes, SHOWN_CHARS)}\n</shared-context>`,
      ].join("\n");
    });

  return { onDefaultHead, refresh, changesFor, notice, fromDefaultBranch };
}
