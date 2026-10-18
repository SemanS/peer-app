// @effect-diagnostics nodeBuiltinImport:off - the Git boundary owns its private scratch objects.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Result from "effect/Result";
import type * as VcsProcess from "../../../../vcs/VcsProcess.ts";
import {
  FETCH_BRANCHES,
  FETCH_LIST_MS,
  FETCH_MS,
  MERGE_BYTES,
  MERGE_FILES,
  MERGE_MS,
  MIN_GIT,
  REF_BYTES,
} from "../limits.ts";
export class ForecastError extends Data.TaggedError("ForecastError")<{ readonly reason: string }> {}
export type GitProbe = {
  state: "supported" | "git-missing" | "git-old" | "git-unreadable";
  version?: string;
};
export type Repository = { readonly common: string; readonly objects: string };
export type MergeResult =
  | { state: "clean" }
  | {
      state: "conflict";
      files: ReadonlyArray<string>;
      more: number;
      /** The first conflicting hunk of the first file, each side's text, when asked for. */
      lines?: { file: string; a: string; b: string };
    }
  | { state: "unrelated" | "slow" | "failed" };
export function parseGitVersion(text: string): GitProbe {
  const match = /^git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(text.trim());
  if (match === null) return { state: "git-unreadable" };
  const major = Number(match[1]),
    minor = Number(match[2]);
  return {
    state:
      major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1]) ? "supported" : "git-old",
    version: `${major}.${minor}.${match[3] ?? "0"}`,
  };
}
/** The first `<<<<<<<`…`>>>>>>>` hunk of a merged file; a diff3 base section is not either side's. */
export function firstHunk(text: string) {
  const hunk = /^<{7}[^\n]*\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7}/m.exec(text);
  if (hunk === null) return undefined;
  return { a: hunk[1]!.split(/^\|{7}/m)[0]!.trimEnd(), b: hunk[2]!.trimEnd() };
}
export const isForecastRef = (ref: string) =>
  ref !== "" &&
  Buffer.byteLength(ref) <= REF_BYTES &&
  ref !== "@" &&
  !Array.from(ref).some(
    (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
  ) &&
  !/^[/-]|[/.]$|[~^:?*[\\]|\.\.|@\{|\/\//.test(ref) &&
  ref.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
/**
 * Local branches (jj exports its bookmarks there) and the teammates' tips a fetch wrote. The fetch
 * never writes `refs/remotes/*`: jj would import them as remote bookmarks, and in Git they are the
 * user's remote-tracking branches, so it uses a namespace neither shows (design D5).
 */
const FORECAST_REFS = /^refs\/(heads|peer\/forecast)\//;
export const fetchedRef = (branch: string) => `refs/peer/forecast/${branch}`;
/**
 * A teammate's shared work in progress, as a Jujutsu checkout shares it. Peer fetches it here and
 * pushes it to `refs/peer/wip/*`: jj imports only heads, tags and remotes, so no bookmark appears.
 */
export const WIP_REFSPEC = "+refs/peer/wip/*:refs/peer/forecast/wip/*";
export const wipRef = (branch: string) => `refs/peer/wip/${branch}`;
export const sharedRef = (branch: string) => `refs/peer/forecast/wip/${branch}`;
const oid = (text: string) => /^[a-f0-9]{40,64}$/.test(text);
const io = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: () => new ForecastError({ reason: "Could not prepare forecast scratch data." }),
  });
/** Every command after discovery runs outside checkouts. Only an explicit fetch may update refs. */
export function createGit(
  vcs: VcsProcess.VcsProcess["Service"],
  directory: string,
  platform: NodeJS.Platform = "linux",
) {
  const cache = new Map<string, Repository>();
  const env = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
    GIT_CONFIG_PARAMETERS: undefined,
    GIT_OBJECT_DIRECTORY: undefined,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
    GIT_INDEX_FILE: undefined,
    GIT_WORK_TREE: undefined,
    GIT_DIR: undefined,
    GIT_COMMON_DIR: undefined,
  };
  const run = (
    args: ReadonlyArray<string>,
    timeoutMs = MERGE_MS,
    extra: NodeJS.ProcessEnv = {},
    cwd = directory,
  ) =>
    vcs.run({
      operation: "Peer.forecast",
      command: "git",
      args,
      cwd,
      env: { ...env, ...extra },
      allowNonZeroExit: true,
      timeoutMs,
      maxOutputBytes: MERGE_BYTES,
      outputMode: "error",
    });
  const args = (repository: Repository) => [
    `--git-dir=${repository.common}`,
    `--work-tree=${directory}`,
    "-c",
    `core.attributesFile=${platform === "win32" ? "NUL" : "/dev/null"}`,
    "-c",
    "merge.default=text",
  ];
  const forget = (repository: Repository) => {
    for (const [key, value] of cache) if (value.common === repository.common) cache.delete(key);
  };
  return {
    probeGit: () =>
      run(["--version"]).pipe(
        Effect.map((answer) =>
          answer.exitCode === 0 && !answer.stdoutTruncated && !answer.stdoutInvalidUtf8
            ? parseGitVersion(answer.stdout)
            : { state: "git-unreadable" as const },
        ),
        Effect.catch((error) =>
          Effect.succeed<GitProbe>({
            state: error._tag === "VcsProcessSpawnError" ? "git-missing" : "git-unreadable",
          }),
        ),
      ),
    sweepScratch: () =>
      io(async () => {
        await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
        for (const entry of await NodeFSP.readdir(directory, { withFileTypes: true }))
          if (entry.name.startsWith("round-"))
            await NodeFSP.rm(NodePath.join(directory, entry.name), {
              recursive: true,
              force: true,
            });
      }),
    discoverRepository: (checkout: string) =>
      Effect.gen(function* () {
        const known = cache.get(checkout);
        if (known !== undefined) return known;
        const answer = yield* run(
          ["rev-parse", "--path-format=absolute", "--git-common-dir", "--git-path", "objects"],
          MERGE_MS,
          {},
          checkout,
        );
        const paths = answer.stdout.trimEnd().split("\n");
        if (answer.exitCode !== 0 || paths.length !== 2 || !paths.every(NodePath.isAbsolute))
          return yield* new ForecastError({ reason: "Forecast checkout is not a repository." });
        const repository = { common: paths[0]!, objects: paths[1]! };
        cache.set(checkout, repository);
        return repository;
      }),
    readTips: (repository: Repository, refs: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const accepted = refs.filter(
          (ref) => FORECAST_REFS.test(ref) && isForecastRef(ref.replace(FORECAST_REFS, "")),
        );
        if (accepted.length === 0) return new Map<string, string>();
        const answer = yield* run([
          ...args(repository),
          "for-each-ref",
          "--format=%(objectname) %(refname)",
          ...accepted,
        ]);
        if (answer.exitCode !== 0 || answer.stdoutTruncated || answer.stdoutInvalidUtf8) {
          forget(repository);
          return yield* new ForecastError({ reason: "Could not read forecast branch tips." });
        }
        return new Map(
          answer.stdout
            .trim()
            .split("\n")
            .flatMap((line) => {
              const [id, ref] = line.split(" ");
              return id !== undefined && ref !== undefined && oid(id) && accepted.includes(ref)
                ? [[ref, id] as const]
                : [];
            }),
        );
      }).pipe(Effect.tapError(() => Effect.sync(() => forget(repository)))),
    withScratch: <A, E, R>(use: (objects: string) => Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        io(async () => {
          const round = await NodeFSP.mkdtemp(NodePath.join(directory, "round-"));
          const objects = NodePath.join(round, "objects");
          await NodeFSP.mkdir(objects, { mode: 0o700 });
          return { round, objects };
        }),
        ({ objects }) => use(objects),
        ({ round }) =>
          io(() => NodeFSP.rm(round, { recursive: true, force: true })).pipe(Effect.ignore),
      ),
    mergeTree: (repository: Repository, objects: string, a: string, b: string, excerpt = false) =>
      Effect.gen(function* () {
        if (!oid(a) || !oid(b)) return { state: "failed" } as MergeResult;
        const scratchEnv = {
          GIT_OBJECT_DIRECTORY: objects,
          GIT_ALTERNATE_OBJECT_DIRECTORIES: [repository.objects].join(NodePath.delimiter),
        };
        const answer = yield* run(
          [...args(repository), "merge-tree", "--write-tree", "-z", "--name-only", a, b],
          MERGE_MS,
          scratchEnv,
        ).pipe(Effect.result);
        if (Result.isFailure(answer)) {
          forget(repository);
          return {
            state: answer.failure._tag === "VcsProcessTimeoutError" ? "slow" : "failed",
          } as MergeResult;
        }
        const value = answer.success;
        if (value.stdoutTruncated || value.stdoutInvalidUtf8 || value.stderrTruncated)
          return { state: "failed" } as MergeResult;
        if (value.exitCode === 0) return { state: "clean" } as MergeResult;
        if (value.exitCode === 1) {
          const fields = value.stdout.split("\0"),
            end = fields.indexOf("", 1),
            files = fields.slice(1, end === -1 ? fields.length : end);
          if (!oid(fields[0] ?? "") || end < 2 || files.length === 0)
            return { state: "failed" } as MergeResult;
          const shown = excerpt
            ? yield* run(
                [...args(repository), "cat-file", "blob", `${fields[0]}:${files[0]}`],
                MERGE_MS,
                scratchEnv,
              ).pipe(
                Effect.map((blob) => (blob.exitCode === 0 ? firstHunk(blob.stdout) : undefined)),
                Effect.orElseSucceed(() => undefined),
              )
            : undefined;
          return {
            state: "conflict",
            files: files.slice(0, MERGE_FILES),
            more: Math.max(0, files.length - MERGE_FILES),
            ...(shown === undefined ? {} : { lines: { file: files[0]!, ...shown } }),
          } as MergeResult;
        }
        forget(repository);
        return {
          state: value.stderr.includes("refusing to merge unrelated histories")
            ? "unrelated"
            : "failed",
        } as MergeResult;
      }),
    fetchBranches: (repository: Repository, branches: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const accepted = [...new Set(branches.filter(isForecastRef))].slice(0, FETCH_BRANCHES);
        if (accepted.length === 0) return { state: "done" } as const;
        // A teammate's branch that is not pushed yet is no failure: asking for it by name would
        // make Git refuse the whole fetch, so origin is asked first which of them exist.
        const listed = yield* run(
          [
            ...args(repository),
            "ls-remote",
            "--heads",
            "origin",
            ...accepted.map((b) => `refs/heads/${b}`),
          ],
          FETCH_LIST_MS,
        ).pipe(Effect.result);
        if (!(Result.isSuccess(listed) && listed.success.exitCode === 0)) {
          forget(repository);
          return { state: "failed", reason: "Could not fetch the named origin branches." } as const;
        }
        const pushed = new Set(
            listed.success.stdout.split("\n").map((line) => line.split("\t")[1]),
          ),
          present = accepted.filter((branch) => pushed.has(`refs/heads/${branch}`));
        if (present.length === 0) return { state: "done" } as const;
        const answer = yield* run(
          [
            ...args(repository),
            "-c",
            "gc.auto=0",
            "-c",
            "maintenance.auto=false",
            "fetch",
            "--no-tags",
            "--no-recurse-submodules",
            "--no-write-fetch-head",
            // No opportunistic update of origin's configured remote-tracking refs either.
            "--refmap=",
            "--quiet",
            "origin",
            ...present.map((branch) => `+refs/heads/${branch}:${fetchedRef(branch)}`),
          ],
          FETCH_MS - FETCH_LIST_MS,
        ).pipe(Effect.result);
        if (Result.isSuccess(answer) && answer.success.exitCode === 0)
          return { state: "done" } as const;
        forget(repository);
        return { state: "failed", reason: "Could not fetch the named origin branches." } as const;
      }),
    /** Teammates' shared work in progress; a ref deleted on origin is pruned here too. */
    fetchShared: (repository: Repository) =>
      run(
        [
          ...args(repository),
          "-c",
          "gc.auto=0",
          "-c",
          "maintenance.auto=false",
          "fetch",
          "--no-tags",
          "--no-recurse-submodules",
          "--no-write-fetch-head",
          "--refmap=",
          "--prune",
          "--quiet",
          "origin",
          WIP_REFSPEC,
        ],
        FETCH_MS,
      ).pipe(
        Effect.map((answer) => answer.exitCode === 0),
        Effect.orElseSucceed(() => false),
        Effect.tap((done) => Effect.sync(() => done || forget(repository))),
      ),
    /** Publishes one work-in-progress commit, or with no commit deletes its ref; true when origin took it. */
    pushWip: (repository: Repository, branch: string, commit?: string) =>
      Effect.gen(function* () {
        if (!isForecastRef(branch) || (commit !== undefined && !oid(commit))) return false;
        const refspec =
          commit === undefined ? `:${wipRef(branch)}` : `+${commit}:${wipRef(branch)}`;
        const answer = yield* run(
          [...args(repository), "push", "--no-verify", "--quiet", "origin", refspec],
          FETCH_MS,
        ).pipe(Effect.result);
        return Result.isSuccess(answer) && answer.success.exitCode === 0;
      }),
    /** When each commit's change was started: its author time, which jj keeps as the change's start. */
    authorTimes: (repository: Repository, commits: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const accepted = commits.filter(oid);
        if (accepted.length === 0) return new Map<string, number>();
        const answer = yield* run([
          ...args(repository),
          "show",
          "-s",
          "--format=%H %at",
          ...accepted,
        ]).pipe(Effect.result);
        if (!Result.isSuccess(answer) || answer.success.exitCode !== 0)
          return new Map<string, number>();
        return new Map(
          answer.success.stdout.split("\n").flatMap((line) => {
            const [id, at] = line.split(" ");
            return id !== undefined && oid(id) && Number.isFinite(Number(at))
              ? [[id, Number(at) * 1000] as const]
              : [];
          }),
        );
      }),
    isAncestor: (repository: Repository, ancestor: string, descendant: string) =>
      oid(ancestor) && oid(descendant)
        ? run([...args(repository), "merge-base", "--is-ancestor", ancestor, descendant]).pipe(
            Effect.map((answer) => answer.exitCode === 0),
            Effect.orElseSucceed(() => false),
          )
        : Effect.succeed(false),
    changedFiles: (repository: Repository, a: string, b: string) =>
      oid(a) && oid(b)
        ? run([...args(repository), "diff", "--name-only", "-z", a, b]).pipe(
            Effect.map((answer) =>
              answer.exitCode === 0 ? new Set(answer.stdout.split("\0").filter(Boolean)) : null,
            ),
            Effect.orElseSucceed(() => null),
          )
        : Effect.succeed(null),
    /** A private ref that makes an object known to jj (a tag), or drops it again. */
    setRef: (repository: Repository, ref: string, commit?: string) =>
      run(
        commit === undefined
          ? [...args(repository), "update-ref", "-d", ref]
          : [...args(repository), "update-ref", ref, commit],
      ).pipe(
        Effect.map((answer) => answer.exitCode === 0),
        Effect.orElseSucceed(() => false),
      ),
  };
}
