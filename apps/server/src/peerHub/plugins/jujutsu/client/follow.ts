/**
 * The jj calls and parsers behind following (design D6): what the work builds on, fetching one
 * bookmark, moving the session's own changes onto another change, and what a move changed. Peer's
 * own steps here run under `peer·follow`, so the operation log groups them as Peer's.
 *
 * @module peerHub/plugins/jujutsu/client/follow
 */
import * as Effect from "effect/Effect";

import { exactStringPattern, localBookmarkRevset } from "../../../../vcs/JjRevset.ts";
import { union } from "../config.ts";
import { asPeer, lines, type Jj, type JjResult } from "./jj.ts";

/** A change the work builds on, at the commit it is at now. */
export interface Built {
  /** The full change id. */
  readonly change: string;
  readonly commit: string;
  /** The untracked remote bookmark it carries, when it has one. */
  readonly bookmark?: string;
}

/** What a move changed in one file: the lines it added and removed, and the first line it added. */
export interface FileChange {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly first?: string;
}

const SHORT = 3_000;
const FETCH_MS = 3_000;
const MOVE_MS = 8_000;

/** The change ids of the session and of the repository's other workspaces. */
interface Own {
  readonly mine: ReadonlyArray<string>;
  readonly others: ReadonlyArray<string>;
}
const BUILT_TEMPLATE =
  'change_id ++ "\\t" ++ commit_id ++ "\\t" ++ remote_bookmarks.filter(|b| !b.tracked() && b.remote() != "git").map(|b| b.name()).join(",") ++ "\\n"';

const builtOf = (done: JjResult): ReadonlyArray<Built> =>
  done.ok
    ? lines(done.out).flatMap((line) => {
        const [change, commit, bookmarks] = line.split("\t");
        if (change === undefined || commit === undefined) return [];
        const bookmark = bookmarks?.split(",")[0];
        return [{ change, commit, ...(bookmark ? { bookmark } : {}) }];
      })
    : [];

/** What the told set keeps per followed change: the commit it was at when the agent last heard. */
export const keyOf = (built: Built) => built.bookmark ?? built.change;

/**
 * The followed changes that moved since the agent last heard, with the commit it heard of: the
 * digest per followed change is that commit. The first sight of a change is only remembered.
 */
export function movesIn(told: Set<string>, seen: ReadonlyArray<Built>) {
  const moves: Array<{ readonly built: Built; readonly was: string }> = [];
  for (const built of seen) {
    const prefix = `moved:${keyOf(built)}:`;
    const old = [...told].find((entry) => entry.startsWith(prefix));
    const was = old?.slice(prefix.length);
    if (was === built.commit) continue;
    if (old !== undefined) told.delete(old);
    told.add(`${prefix}${built.commit}`);
    if (was !== undefined) moves.push({ built, was });
  }
  return moves;
}

/** Whose change `built` is, among the others' ids and bookmarks. */
export const ownedBy = <
  T extends { readonly ids: ReadonlyArray<string>; readonly bookmark?: string | undefined },
>(
  others: ReadonlyArray<T>,
  built: Built,
) =>
  others.find(
    (other) =>
      other.ids.some((id) => id.startsWith(built.change) || built.change.startsWith(id)) ||
      (built.bookmark !== undefined && other.bookmark === built.bookmark),
  );

/** The bookmarks a `jj git push` names with `-b` or `--bookmark`, as the revset of what it pushes. */
export function pushedRange(args: ReadonlyArray<string>) {
  const names = args.flatMap((word, at) =>
    word === "-b" || word === "--bookmark"
      ? [args[at + 1] ?? ""]
      : word.startsWith("--bookmark=")
        ? [word.slice(11)]
        : [],
  );
  return {
    names,
    revset: names.length === 0 ? undefined : `::(${names.map(localBookmarkRevset).join(" | ")})`,
  };
}

/** The target of a bookmark: a local one, else the remote's. */
export const bookmarkRevset = (name: string, remote = "origin") =>
  `coalesce(${localBookmarkRevset(name)}, remote_bookmarks(${exactStringPattern(name)}, ${exactStringPattern(remote)}))`;

/** `a.js +3` per file, from a git-format diff. */
export function filesOf(diff: string): ReadonlyArray<FileChange> {
  const files: Array<{ path: string; added: number; removed: number; first?: string }> = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = line.split(" b/").at(-1);
      if (path !== undefined) files.push({ path, added: 0, removed: 0 });
    } else if (files.length > 0 && !line.startsWith("+++") && !line.startsWith("---")) {
      const file = files[files.length - 1]!;
      if (line.startsWith("+")) {
        file.added++;
        file.first ??= line.slice(1).trim();
      } else if (line.startsWith("-")) file.removed++;
    }
  }
  return files;
}

/** The bookmarks to fetch now: at most three, the one fetched longest ago first. */
export const dueBookmarks = (
  known: ReadonlyMap<string, string>,
  fetched: ReadonlyMap<string, number>,
) =>
  [...known.keys()].toSorted((a, b) => (fetched.get(a) ?? 0) - (fetched.get(b) ?? 0)).slice(0, 3);

export const makeFollow = (jj: Jj) => {
  const read = (repo: string, cwd: string, revset: string, template: string) =>
    jj.run(repo, cwd, ["log", "--no-graph", "-r", revset, "-T", template], {
      ...jj.read,
      timeoutMs: SHORT,
    });
  const built = (repo: string, cwd: string, revset: string) =>
    read(repo, cwd, revset, BUILT_TEMPLATE).pipe(Effect.map(builtOf));
  const resolve = (repo: string, cwd: string, revset: string) =>
    built(repo, cwd, revset).pipe(Effect.map((found) => found[0] ?? null));
  // Upstream's guard against abandoning commits keeps the old version of a force-pushed change
  // visible next to the new one, which is a divergent change. A fetch of one bookmark is where jj
  // hides it, as it does by default (fact 4).
  const fetch = (repo: string, cwd: string, bookmark: string, timeoutMs: number) =>
    jj.run(repo, cwd, ["git", "fetch", "-b", exactStringPattern(bookmark)], {
      timeoutMs,
      config: [...asPeer("follow"), ["git.abandon-unreachable-commits", "true"]],
    });
  const outcome = (done: JjResult) => (done.ok ? "done" : done.late ? "timeout" : "refused");

  /**
   * What the work builds on: teammates' changes behind untracked remote bookmarks that have not
   * landed, and the other workspaces' own changes, among the ancestors of `@` (or of `within`).
   * The session's own changes are never among them.
   */
  const builtOn = (repo: string, cwd: string, input: Own & { readonly within?: string }) => {
    const scope = input.within ?? "::@";
    return built(
      repo,
      cwd,
      `(((${scope} ~ ::trunk()) & untracked_remote_bookmarks()) | (${union(input.others)} & ${scope})) ~ (${union(input.mine)})`,
    );
  };

  /**
   * Moves the session's own changes (the lowest of them, and what sits on it) onto `onto`. Answers
   * jj's own lines, and the files left in conflict in the session's changes.
   */
  const move = (repo: string, cwd: string, input: { mine: ReadonlyArray<string>; onto: string }) =>
    Effect.gen(function* () {
      const own = `(${union(input.mine)} & ::@) | @`;
      const root = yield* read(repo, cwd, `roots(${own})`, 'change_id.short(8) ++ "\\n"');
      const done = yield* jj.run(repo, cwd, ["rebase", "-s", `roots(${own})`, "-o", input.onto], {
        timeoutMs: MOVE_MS,
        config: asPeer("follow"),
        loud: true,
      });
      // jj reports on stderr: its progress lines, then hints Peer leaves out.
      const output = lines(done.err).filter((line) => !/^(Hint|Warning):/.test(line));
      return {
        ok: done.ok,
        outcome: outcome(done),
        error: output[0] ?? "jj did not move the change",
        change: lines(root.out)[0] ?? "",
        output,
        conflicts: done.ok ? yield* makeConflicts(jj)(repo, cwd, input.mine) : [],
      };
    });

  return {
    builtOn,
    resolve,

    /**
     * `peer follow`: finds the change `bookmark` names (fetching that one bookmark when it is not
     * here), or trunk without a bookmark, and moves the session's changes onto it.
     */
    start: (
      repo: string,
      cwd: string,
      input: { bookmark?: string | undefined; mine: ReadonlyArray<string> },
    ) =>
      Effect.gen(function* () {
        const revset = input.bookmark === undefined ? "trunk()" : bookmarkRevset(input.bookmark);
        let target = input.bookmark === undefined ? null : yield* resolve(repo, cwd, revset);
        if (input.bookmark !== undefined && target === null) {
          yield* fetch(repo, cwd, input.bookmark, MOVE_MS);
          target = yield* resolve(repo, cwd, revset);
        }
        if (input.bookmark !== undefined && target === null)
          return {
            ok: false as const,
            outcome: "refused",
            error: `${input.bookmark} is not on this computer or on its remote`,
          };
        return { ...(yield* move(repo, cwd, { mine: input.mine, onto: revset })), target };
      }),

    /**
     * Fetches the due bookmarks, one at a time while `left` allows, and moves the work onto the tip
     * of a Git teammate's branch. A jj teammate's change keeps its id, so jj has moved the work
     * already when it carries the new tip. Answers how each call ended, for the log.
     */
    keepCurrent: (
      repo: string,
      cwd: string,
      input: Own & {
        readonly due: ReadonlyArray<string>;
        readonly known: ReadonlyMap<string, string>;
        readonly left: () => Effect.Effect<number>;
      },
    ) =>
      Effect.gen(function* () {
        const results: Array<{ action: "fetch" | "follow"; outcome: string }> = [];
        const tips = new Map<string, Built | null>();
        for (const bookmark of input.due) {
          if ((yield* input.left()) < FETCH_MS + 300) break;
          const fetched = yield* fetch(repo, cwd, bookmark, FETCH_MS);
          results.push({ action: "fetch", outcome: outcome(fetched) });
          if (fetched.ok) tips.set(bookmark, yield* resolve(repo, cwd, bookmarkRevset(bookmark)));
        }
        const seen = tips.size === 0 ? [] : yield* builtOn(repo, cwd, input);
        for (const [bookmark, tip] of tips) {
          const before = input.known.get(bookmark);
          if (tip === null || before === undefined || tip.commit === before) continue;
          if (seen.some((one) => one.commit === tip.commit)) continue;
          const moved = yield* move(repo, cwd, {
            mine: input.mine,
            onto: bookmarkRevset(bookmark),
          });
          results.push({ action: "follow", outcome: moved.outcome });
        }
        return results;
      }),

    /** What a followed change's new version changed since `from`, and the conflicts the work holds now. */
    moved: (repo: string, cwd: string, from: string, to: string, mine: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const diff = yield* jj.run(repo, cwd, ["interdiff", "--from", from, "--to", to, "--git"], {
          ...jj.read,
          timeoutMs: SHORT,
        });
        return {
          files: diff.ok ? filesOf(diff.out) : [],
          conflicts: yield* makeConflicts(jj)(repo, cwd, mine),
        };
      }),
  };
};

/** The files in conflict among the session's own changes and its working copy. */
const makeConflicts = (jj: Jj) => (repo: string, cwd: string, mine: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const found = yield* jj.run(
      repo,
      cwd,
      [
        "log",
        "--no-graph",
        "-r",
        `((${union(mine)}) | @) & conflicts()`,
        "-T",
        'change_id ++ "\\n"',
      ],
      { ...jj.read, timeoutMs: SHORT },
    );
    const files = new Set<string>();
    for (const id of lines(found.out)) {
      const listed = yield* jj.run(repo, cwd, ["resolve", "--list", "-r", id], {
        ...jj.read,
        timeoutMs: SHORT,
      });
      for (const line of lines(listed.out)) {
        const path = /^(.+?)\s+\d+-sided/.exec(line)?.[1];
        if (path !== undefined) files.add(path);
      }
    }
    return [...files];
  });
