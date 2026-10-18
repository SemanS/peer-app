import { PEER_FORECAST_CHECK_OUTPUT_MAX, type PeerForecastCheck } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { jjRunner } from "../../../../vcs/JjProcess.ts";
import type * as VcsProcess from "../../../../vcs/VcsProcess.ts";
import { CHECK_BYTES, CHECK_MS, JJ_STEP_MS } from "../limits.ts";
import type { createGit, Repository } from "./git.ts";

/** An agent's working-copy commit, with the names that tie it to a session's bookmark. */
export type WorkingCopy = {
  readonly commit: string;
  readonly workspaces: ReadonlyArray<string>;
  readonly bookmarks: ReadonlyArray<string>;
  readonly parentBookmarks: ReadonlyArray<string>;
};
export type CheckOutcome = { state: PeerForecastCheck["state"]; output?: string };

/** What the operation log shows for the steps of a check. */
export const CHECK_USER = "peer·check";
const CHECK_DESCRIPTION = "peer check";
const list = (names: string) => names.split("\t").filter(Boolean);
const oid = (text: string) => /^[a-f0-9]{40,64}$/.test(text);
const TEMPLATE =
  'commit_id ++ "\\0" ++ working_copies.map(|w| w.name()).join("\\t") ++ "\\0" ++ ' +
  'local_bookmarks.map(|b| b.name()).join("\\t") ++ "\\0" ++ ' +
  'parents.map(|p| p.local_bookmarks().map(|b| b.name()).join("\\t")).join("\\t") ++ "\\n"';
/** jj's own words around the output of a failed command, which are not the command's. */
const JJ_NOISE = /^(Error: the command |Hint: Failed revision|Nothing changed)/;

/**
 * jj for the forecast. Every call ignores the working copy: reading must not snapshot anyone's
 * workspace, and a check's throwaway change has none.
 */
export function createJj(vcs: VcsProcess.VcsProcess["Service"], git: ReturnType<typeof createGit>) {
  const jj = jjRunner(vcs);
  const step = (
    cwd: string,
    args: ReadonlyArray<string>,
    options: { checking?: boolean; timeoutMs?: number; maxOutputBytes?: number } = {},
  ) =>
    jj("Peer.forecast.jj", cwd, args, {
      ignoreWorkingCopy: true,
      allowNonZeroExit: true,
      timeoutMs: options.timeoutMs ?? JJ_STEP_MS,
      ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
      ...(options.checking === true ? { config: [["operation.username", CHECK_USER]] } : {}),
    }).pipe(Effect.result);
  const ok = <A extends { exitCode: number }>(answer: Result.Result<A, unknown>) =>
    Result.isSuccess(answer) && answer.success.exitCode === 0 ? answer.success : null;
  const visible = (cwd: string, commit: string) =>
    step(cwd, [
      "log",
      "--no-graph",
      "-r",
      `${commit} & ::visible_heads()`,
      "-T",
      'commit_id ++ "\\n"',
    ]).pipe(Effect.map((answer) => ok(answer)?.stdout.includes(commit) === true));
  /** The throwaway changes of earlier checks on this pair, ours or left by a crash. */
  const leftovers = (a: string, b: string) =>
    `children(${a}) & children(${b}) & description(exact:"${CHECK_DESCRIPTION}\\n")`;

  /**
   * The throwaway change, the command in its own copy of it, and the cleanup. A commit jj does
   * not know yet (a teammate's, fetched under a private ref) is made known by a tag that lives
   * only for the check; `jj git import` is how jj learns any Git object. Bookmarks stay as they
   * were and the throwaway commits are abandoned.
   */
  const check = (
    cwd: string,
    repository: Repository,
    commits: readonly [string, string],
    command: string,
    timeoutMs = CHECK_MS,
  ) =>
    Effect.gen(function* () {
      const [a, b] = commits;
      const imported: string[] = [];
      const unreadable: CheckOutcome = { state: "couldNotRead" };
      const cleanup = Effect.gen(function* () {
        yield* step(cwd, ["abandon", leftovers(a, b)], { checking: true });
        if (imported.length === 0) return;
        for (const commit of imported) yield* git.setRef(repository, tagOf(commit));
        yield* step(cwd, ["git", "import"], { checking: true });
        const wanted = imported.join(" | ");
        yield* step(cwd, ["abandon", `::(${wanted}) ~ ::(visible_heads() ~ (${wanted}))`], {
          checking: true,
        });
      }).pipe(Effect.ignore, Effect.uninterruptible);
      const run = Effect.gen(function* () {
        if (!oid(a) || !oid(b)) return unreadable;
        for (const commit of new Set([a, b]))
          if (!(yield* visible(cwd, commit))) {
            imported.push(commit);
            if (!(yield* git.setRef(repository, tagOf(commit), commit))) return unreadable;
          }
        if (
          imported.length > 0 &&
          ok(yield* step(cwd, ["git", "import"], { checking: true })) === null
        )
          return unreadable;
        const made = yield* step(cwd, ["new", "--no-edit", a, b, "-m", CHECK_DESCRIPTION], {
          checking: true,
        });
        if (ok(made) === null) return unreadable;
        const found = ok(
          yield* step(cwd, [
            "log",
            "--no-graph",
            "-r",
            leftovers(a, b),
            "-T",
            'commit_id ++ "\\n"',
          ]),
        );
        const change = found?.stdout.split("\n").find(oid);
        if (change === undefined) return unreadable;
        const ran = yield* step(
          cwd,
          ["run", "--ignore-changes", "-r", change, "--", "sh", "-c", command],
          { checking: true, timeoutMs, maxOutputBytes: CHECK_BYTES },
        );
        if (Result.isFailure(ran))
          return ran.failure._tag === "VcsProcessTimeoutError"
            ? ({ state: "timedOut" } satisfies CheckOutcome)
            : unreadable;
        if (ran.success.exitCode === 0) return { state: "passed" } satisfies CheckOutcome;
        // jj reports a failed command in its own words; anything else is jj failing to run it.
        if (!/^Error: the command .* failed with exit status/m.test(ran.success.stderr))
          return unreadable;
        const output = [ran.success.stdout, ran.success.stderr]
          .join("\n")
          .split("\n")
          .filter((line) => !JJ_NOISE.test(line))
          .join("\n")
          .trim()
          .slice(0, PEER_FORECAST_CHECK_OUTPUT_MAX);
        return { state: "fails", ...(output === "" ? {} : { output }) } satisfies CheckOutcome;
      });
      return yield* run.pipe(Effect.ensuring(cleanup));
    });

  return {
    /** Whether `cwd` is a jj workspace. */
    isJj: (cwd: string) => step(cwd, ["root"]).pipe(Effect.map((answer) => ok(answer) !== null)),
    /** The working copy of every workspace, as jj last snapshotted it. */
    workingCopies: (cwd: string) =>
      step(cwd, ["log", "--no-graph", "-r", "working_copies()", "-T", TEMPLATE]).pipe(
        Effect.map((answer): WorkingCopy[] =>
          (ok(answer)?.stdout ?? "").split("\n").flatMap((line) => {
            const [commit = "", workspaces = "", bookmarks = "", parents = ""] = line.split("\0");
            return oid(commit)
              ? [
                  {
                    commit,
                    workspaces: list(workspaces),
                    bookmarks: list(bookmarks),
                    parentBookmarks: list(parents),
                  },
                ]
              : [];
          }),
        ),
      ),
    /** The change ids of the commits this repository knows; the others are left out. */
    changeIds: (cwd: string, commits: ReadonlyArray<string>) =>
      commits.filter(oid).length === 0
        ? Effect.succeed(new Map<string, string>())
        : step(cwd, [
            "log",
            "--no-graph",
            "-r",
            commits
              .filter(oid)
              .map((commit) => `present(${commit})`)
              .join(" | "),
            "-T",
            'commit_id ++ " " ++ change_id.short(8) ++ "\\n"',
          ]).pipe(
            Effect.map(
              (answer) =>
                new Map(
                  (ok(answer)?.stdout ?? "").split("\n").flatMap((line) => {
                    const [commit = "", change = ""] = line.split(" ");
                    return oid(commit) && change !== "" ? [[commit, change] as const] : [];
                  }),
                ),
            ),
          ),
    check,
  };
}
const tagOf = (commit: string) => `refs/tags/peer-check/${commit}`;
export type JjClient = ReturnType<typeof createJj>;
