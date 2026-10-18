/**
 * Every jj call this plugin makes, through upstream's `JjProcess` (its global arguments, its stale
 * workspace retry). Peer's own calls in one repository run one at a time: jj's operation log is
 * lock-free, and two of Peer's writes racing each other would only make more to merge. An agent's
 * own jj commands are not held up by this.
 *
 * A call never fails: it answers how it ended, and `late` when it missed its time. Only stdout is
 * parsed (jj's warnings and hints are on stderr).
 *
 * @module peerHub/plugins/jujutsu/client/jj
 */
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import { jjCommand, type JjCommandOptions } from "../../../../vcs/JjProcess.ts";
import type { VcsProcess } from "../../../../vcs/VcsProcess.ts";

export interface JjResult {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
  /** It did not answer within its time. */
  readonly late: boolean;
}

/** The working-copy change of a workspace, as the plugin records and judges it. */
export interface Working {
  readonly id: string;
  /** Its commit, which moves whenever the snapshot found an edit. */
  readonly commit: string;
  /** It has no edits yet and no description: not worth calling the session's own. */
  readonly blank: boolean;
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

export function makeJj(vcs: VcsProcess["Service"]) {
  const locks = new Map<string, Semaphore.Semaphore>();
  const lockOf = (repo: string) => {
    const known = locks.get(repo) ?? Semaphore.makeUnsafe(1);
    locks.set(repo, known);
    return known;
  };

  /** `jj <args>` in `cwd`, serialized with Peer's other calls in `repo`. */
  const run = (
    repo: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options: JjCommandOptions & { readonly timeoutMs: number },
  ): Effect.Effect<JjResult> =>
    lockOf(repo).withPermits(1)(
      jjCommand(vcs, `jujutsu.${args[0] ?? "jj"}`, cwd, args, options).pipe(
        Effect.map((done): JjResult => ({
          ok: done.exitCode === 0,
          out: done.stdout,
          err: done.stderr,
          late: false,
        })),
        Effect.catch((failure) =>
          Effect.succeed<JjResult>({
            ok: false,
            out: "",
            err: String(failure),
            late: failure._tag === "VcsProcessTimeoutError",
          }),
        ),
      ),
    );

  const read = { ignoreWorkingCopy: true, allowNonZeroExit: true } as const;
  const SHORT = 3_000;

  const get = (repo: string, cwd: string, key: string) =>
    run(repo, cwd, ["config", "get", key], { timeoutMs: SHORT }).pipe(
      Effect.map((done) => (done.ok && done.out.trim() !== "" ? done.out.trim() : null)),
    );
  /** Change ids with two visible versions among the ancestors of `@`. */
  const divergent = (repo: string, cwd: string, timeoutMs: number) =>
    run(repo, cwd, ["log", "--no-graph", "-r", "divergent() & ::@", "-T", 'change_id ++ "\\n"'], {
      ...read,
      timeoutMs,
    }).pipe(Effect.map((done) => (done.ok ? [...new Set(lines(done.out))] : [])));

  return {
    /**
     * Writes `keys` into the workspace's own configuration, each only when its value differs from the
     * one `known` holds. `user.*` (`user`) is written only where jj has none, or where Peer wrote it
     * before (`ours`). Answers the `user.*` keys written now.
     */
    apply: (
      repo: string,
      cwd: string,
      input: {
        readonly keys: ReadonlyArray<readonly [string, string]>;
        readonly user: ReadonlyArray<readonly [string, string]>;
        readonly ours: ReadonlyArray<string>;
        readonly known: Map<string, string>;
      },
    ) =>
      Effect.gen(function* () {
        const wanted = [...input.keys];
        for (const [key, value] of input.user)
          if (input.ours.includes(key) || (yield* get(repo, cwd, key)) === null)
            wanted.push([key, value]);
        const fresh: Array<string> = [];
        for (const [key, value] of wanted) {
          if (input.known.get(key) === value) continue;
          const done = yield* run(repo, cwd, ["config", "set", "--workspace", key, value], {
            timeoutMs: SHORT,
          });
          if (!done.ok) continue;
          input.known.set(key, value);
          if (key.startsWith("user.") && !input.ours.includes(key)) fresh.push(key);
        }
        return fresh;
      }),
    /** Removes keys from the workspace's own configuration; a key that is not there is no failure. */
    unset: (repo: string, cwd: string, keys: ReadonlyArray<string>, known?: Map<string, string>) =>
      Effect.forEach(
        keys,
        (key) =>
          run(repo, cwd, ["config", "unset", "--workspace", key], { timeoutMs: SHORT }).pipe(
            Effect.tap(() => Effect.sync(() => known?.delete(key))),
          ),
        { discard: true },
      ),

    /** Takes the workspace's snapshot; updates a stale working copy first (`auto-update-stale`). */
    snapshot: (repo: string, cwd: string, timeoutMs: number) =>
      run(repo, cwd, ["util", "snapshot"], { timeoutMs }),

    /** The working-copy change, read without a snapshot (the caller took one). */
    working: (repo: string, cwd: string) =>
      run(
        repo,
        cwd,
        [
          "log",
          "--no-graph",
          "-r",
          "@",
          "-T",
          'change_id ++ "\\t" ++ commit_id ++ "\\t" ++ if(empty && description == "", "blank", "own")',
        ],
        { ...read, timeoutMs: SHORT },
      ).pipe(
        Effect.map((done): Working | null => {
          const [id, commit, kind] = done.out.trim().split("\t");
          return done.ok && id && commit ? { id, commit, blank: kind === "blank" } : null;
        }),
      ),

    /**
     * Merges the versions a rewrite in another workspace left, never asking a person. Answers the
     * change ids that had two versions and those that still do (jj could not choose).
     */
    converge: (repo: string, cwd: string, timeoutMs: number) =>
      Effect.gen(function* () {
        const found = yield* divergent(repo, cwd, timeoutMs);
        if (found.length === 0) return { found, still: found };
        const revset = found.map((id) => `change_id(${id})`).join(" | ");
        yield* run(repo, cwd, ["converge", "--no-interactive", "-r", revset], { timeoutMs });
        return { found, still: yield* divergent(repo, cwd, timeoutMs) };
      }),

    /** Which of these change ids no longer name work in flight: landed in trunk, or gone. */
    landed: (repo: string, ids: ReadonlyArray<string>) =>
      run(
        repo,
        repo,
        [
          "log",
          "--no-graph",
          "-r",
          `(${ids.map((id) => `change_id(${id})`).join(" | ")}) & mutable() ~ ::trunk()`,
          "-T",
          'change_id ++ "\\n"',
        ],
        { ...read, timeoutMs: SHORT },
      ).pipe(
        Effect.map((done) =>
          done.ok ? ids.filter((id) => !lines(done.out).includes(id)) : ([] as Array<string>),
        ),
      ),
  };
}

export type Jj = ReturnType<typeof makeJj>;
