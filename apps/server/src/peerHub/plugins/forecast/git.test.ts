// @effect-diagnostics nodeBuiltinImport:off - exercises Git only in disposable repositories.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "@effect/vitest";
import * as VcsProcess from "../../../vcs/VcsProcess.ts";
import { ChildProcessSpawner } from "effect/unstable/process";
import { VcsProcessSpawnError, VcsProcessTimeoutError } from "@t3tools/contracts";
import { createGit, isForecastRef, parseGitVersion } from "./git.ts";
const live = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const git = (cwd: string, ...args: string[]) =>
  NodeChildProcess.execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
async function repository() {
  const dir = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-forecast-test-")),
  );
  git(dir, "init", "-q", "-b", "main");
  await NodeFSP.writeFile(NodePath.join(dir, "pay.txt"), "one\n" + "same\n".repeat(20) + "last\n");
  const commit = (message: string) => {
    git(dir, "add", ".");
    git(dir, "-c", "user.name=Ana", "-c", "user.email=ana@test", "commit", "-qm", message);
    return git(dir, "rev-parse", "HEAD");
  };
  const base = commit("base");
  return { dir, base, commit, dispose: () => NodeFSP.rm(dir, { recursive: true, force: true }) };
}
describe("forecast Git boundary", () => {
  it.live(
    "classifies missing Git, timeout, malformed output and cache invalidation at the process boundary",
    () =>
      Effect.gen(function* () {
        const calls: VcsProcess.VcsProcessInput[] = [],
          info = { common: "/repo", objects: "/repo/objects" };
        let mode = "spawn";
        const runner = createGit(
          VcsProcess.VcsProcess.of({
            run: (input) => {
              calls.push(input);
              if (mode === "spawn")
                return Effect.fail(
                  new VcsProcessSpawnError({
                    operation: input.operation,
                    command: input.command,
                    cwd: input.cwd,
                    cause: "not found",
                  }),
                );
              if (mode === "timeout")
                return Effect.fail(
                  new VcsProcessTimeoutError({
                    operation: input.operation,
                    command: input.command,
                    cwd: input.cwd,
                    timeoutMs: 10000,
                  }),
                );
              return Effect.succeed({
                exitCode: ChildProcessSpawner.ExitCode(
                  mode === "failed" ? 2 : mode === "malformed" ? 1 : 0,
                ),
                stdout:
                  input.args[0] === "rev-parse"
                    ? "/repo\n/repo/objects\n"
                    : input.args.includes("ls-remote")
                      ? input.args
                          .filter((arg) => arg.startsWith("refs/heads/"))
                          .map((ref) => `${"a".repeat(40)}\t${ref}`)
                          .join("\n")
                      : "bad",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              });
            },
          }),
          "/private/scratch",
        );
        expect((yield* runner.probeGit()).state).toBe("git-missing");
        mode = "good";
        yield* runner.discoverRepository("/checkout");
        yield* runner.discoverRepository("/checkout");
        expect(calls.filter((c) => c.args[0] === "rev-parse")).toHaveLength(1);
        mode = "timeout";
        expect(
          (yield* runner.mergeTree(info, "/scratch/objects", "a".repeat(40), "b".repeat(40))).state,
        ).toBe("slow");
        const cached = yield* runner.discoverRepository("/checkout").pipe(Effect.result);
        expect(cached._tag).toBe("Failure");
        mode = "good";
        const actual = yield* runner.discoverRepository("/checkout");
        mode = "failed";
        yield* runner.readTips(actual, ["refs/heads/a"]).pipe(Effect.result);
        mode = "good";
        yield* runner.discoverRepository("/checkout");
        expect(calls.filter((c) => c.args[0] === "rev-parse")).toHaveLength(4);
        mode = "malformed";
        expect(
          (yield* runner.mergeTree(actual, "/scratch/objects", "a".repeat(40), "b".repeat(40)))
            .state,
        ).toBe("failed");
        const merge = calls.find((c) => c.args.includes("merge-tree"))!;
        expect(merge.cwd).toBe("/private/scratch");
        expect(merge.timeoutMs).toBe(10000);
        expect(merge.maxOutputBytes).toBe(256 * 1024);
        expect(merge.env?.GIT_NO_LAZY_FETCH).toBe("1");
        mode = "good";
        const before = calls.length;
        yield* runner.fetchBranches(actual, ["-x", "a..b"]);
        expect(calls).toHaveLength(before);
        yield* runner.fetchBranches(
          actual,
          Array.from({ length: 20 }, (_, i) => `feature/${i}`),
        );
        const fetch = calls.at(-1)!;
        // Origin is asked which branches are pushed (5 s) before the fetch (the rest of 20 s).
        expect(calls.at(-2)!.args).toContain("ls-remote");
        expect(calls.at(-2)!.timeoutMs).toBe(5000);
        expect(fetch.timeoutMs).toBe(15000);
        expect(fetch.args.filter((a) => a.startsWith("+refs/heads/"))).toHaveLength(10);
        expect(fetch.args).toContain("--no-write-fetch-head");
        expect(fetch.args).toContain("--no-tags");
      }),
  );
  it.live(
    "fetches only named branches without FETCH_HEAD or broad origin changes, and sweeps only owned leftovers",
    () =>
      Effect.gen(function* () {
        const repo = yield* Effect.promise(() => repository());
        try {
          git(repo.dir, "branch", "feature/a");
          git(repo.dir, "branch", "feature/b");
          git(repo.dir, "clone", "--bare", "-q", repo.dir, NodePath.join(repo.dir, "origin.git"));
          git(repo.dir, "remote", "add", "origin", NodePath.join(repo.dir, "origin.git"));
          const scratch = NodePath.join(repo.dir, "scratch");
          yield* Effect.promise(() =>
            NodeFSP.mkdir(NodePath.join(scratch, "round-orphan"), { recursive: true }),
          );
          yield* Effect.promise(() => NodeFSP.writeFile(NodePath.join(scratch, "keep"), "keep"));
          yield* Effect.gen(function* () {
            const runner = createGit(yield* VcsProcess.VcsProcess, scratch);
            yield* runner.sweepScratch();
            const info = yield* runner.discoverRepository(repo.dir);
            expect(
              // A branch a teammate has not pushed yet must not make the fetch of the others fail.
              yield* runner.fetchBranches(info, [
                "feature/a",
                "feature/a",
                "-unsafe",
                "feature/not-pushed",
              ]),
            ).toEqual({
              state: "done",
            });
            expect(yield* runner.fetchBranches(info, ["feature/not-pushed"])).toEqual({
              state: "done",
            });
          }).pipe(Effect.provide(live));
          expect(git(repo.dir, "for-each-ref", "--format=%(refname)", "refs/remotes/origin")).toBe(
            "refs/remotes/origin/feature/a",
          );
          expect(
            yield* Effect.promise(() =>
              NodeFSP.stat(NodePath.join(repo.dir, ".git", "FETCH_HEAD")).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false);
          expect(yield* Effect.promise(() => NodeFSP.readdir(scratch))).toEqual(["keep"]);
        } finally {
          yield* Effect.promise(() => repo.dispose());
        }
      }),
  );
  it.live.each(["regions", "files", "rename", "delete", "unicode", "unrelated", "driver", "union"])(
    "handles %s using plain text in a disposable repository",
    (kind) =>
      Effect.gen(function* () {
        const repo = yield* Effect.promise(() => repository());
        try {
          if (kind === "driver" || kind === "union") {
            yield* Effect.promise(() =>
              NodeFSP.writeFile(
                NodePath.join(repo.dir, ".gitattributes"),
                `*.txt merge=${kind === "union" ? "union" : "evil"}\n`,
              ),
            );
            repo.commit("attributes");
            git(
              repo.dir,
              "config",
              "merge.evil.driver",
              `sh -c 'touch "${repo.dir}/ran-driver"; false'`,
            );
          }
          const base = git(repo.dir, "rev-parse", "HEAD"),
            name = kind === "unicode" ? "ü file\n.txt" : "pay.txt";
          if (kind === "unicode") {
            yield* Effect.promise(() => NodeFSP.writeFile(NodePath.join(repo.dir, name), "base\n"));
            repo.commit("unicode");
          }
          const actualBase = git(repo.dir, "rev-parse", "HEAD");
          git(repo.dir, "checkout", "-qb", "feature/a");
          if (kind === "rename") git(repo.dir, "mv", "pay.txt", "renamed.txt");
          else if (kind === "delete") git(repo.dir, "rm", "pay.txt");
          else
            yield* Effect.promise(() =>
              NodeFSP.writeFile(
                NodePath.join(repo.dir, kind === "files" ? "a.txt" : name),
                "A\n" + "same\n".repeat(20) + "last\n",
              ),
            );
          const a = repo.commit("a");
          git(repo.dir, "checkout", "-qb", "feature/b", actualBase);
          if (kind === "unrelated") {
            git(repo.dir, "checkout", "--orphan", "other");
            git(repo.dir, "rm", "-rf", ".");
          }
          yield* Effect.promise(() =>
            NodeFSP.writeFile(
              NodePath.join(repo.dir, kind === "files" ? "b.txt" : name),
              kind === "regions"
                ? "one\n" + "same\n".repeat(20) + "B\n"
                : "B\n" + "same\n".repeat(20) + "last\n",
            ),
          );
          const b = repo.commit("b");
          const answer = yield* Effect.gen(function* () {
            const runner = createGit(
              yield* VcsProcess.VcsProcess,
              NodePath.join(repo.dir, "scratch"),
            );
            yield* runner.sweepScratch();
            const info = yield* runner.discoverRepository(repo.dir);
            return yield* runner.withScratch((objects) => runner.mergeTree(info, objects, a, b));
          }).pipe(Effect.provide(live));
          expect(answer.state).toBe(
            kind === "unrelated"
              ? "unrelated"
              : ["regions", "files", "rename"].includes(kind)
                ? "clean"
                : "conflict",
          );
          if (kind === "unicode" && answer.state === "conflict")
            expect(answer.files).toEqual([name]);
          expect(
            yield* Effect.promise(() =>
              NodeFSP.stat(NodePath.join(repo.dir, "ran-driver")).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false);
          expect(base).toHaveLength(40);
        } finally {
          yield* Effect.promise(() => repo.dispose());
        }
      }),
  );
  it("parses supported platform versions and rejects names that could escape branch refs", () => {
    expect(parseGitVersion("git version 2.50.1 (Apple Git-155)")).toEqual({
      state: "supported",
      version: "2.50.1",
    });
    expect(parseGitVersion("git version 2.43.0.windows.1")).toEqual({
      state: "supported",
      version: "2.43.0",
    });
    expect(parseGitVersion("git version 2.37.9")).toEqual({ state: "git-old", version: "2.37.9" });
    for (const text of ["", "garbage"]) expect(parseGitVersion(text).state).toBe("git-unreadable");
    for (const ref of ["feature/krk-1-ab12", "fix/#12", "feature/ünï"])
      expect(isForecastRef(ref)).toBe(true);
    for (const ref of [
      "-x",
      "a..b",
      "a b",
      "x/",
      "y.lock",
      "x\ny",
      "a*b",
      "x".repeat(201),
      "a/@{b",
      "a/.bad",
      "a\\b",
    ])
      expect(isForecastRef(ref)).toBe(false);
  });
  it.live("discovers common objects from a linked worktree and reads only exact branch refs", () =>
    Effect.gen(function* () {
      const repo = yield* Effect.promise(() => repository());
      try {
        const other = NodePath.join(repo.dir, "linked");
        git(repo.dir, "worktree", "add", "-q", "-b", "feature/two", other);
        git(repo.dir, "update-ref", "refs/t3/private", repo.base);
        yield* Effect.gen(function* () {
          const runner = createGit(
            yield* VcsProcess.VcsProcess,
            NodePath.join(repo.dir, "scratch"),
          );
          yield* runner.sweepScratch();
          const discovery = yield* runner.discoverRepository(other);
          expect(discovery.common).toBe(NodePath.join(repo.dir, ".git"));
          expect(discovery.objects).toBe(NodePath.join(repo.dir, ".git", "objects"));
          const tips = yield* runner.readTips(discovery, [
            "refs/heads/main",
            "refs/heads/feature/two",
            "refs/heads/missing",
          ]);
          expect([...tips.keys()].sort()).toEqual(["refs/heads/feature/two", "refs/heads/main"]);
        }).pipe(Effect.provide(live));
      } finally {
        yield* Effect.promise(() => repo.dispose());
      }
    }),
  );
  it.live(
    "predicts a conflict with private scratch objects while leaving refs, objects and checkout untouched",
    () =>
      Effect.gen(function* () {
        const repo = yield* Effect.promise(() => repository());
        try {
          git(repo.dir, "checkout", "-qb", "feature/a");
          yield* Effect.promise(() =>
            NodeFSP.writeFile(
              NodePath.join(repo.dir, "pay.txt"),
              "A\n" + "same\n".repeat(20) + "last\n",
            ),
          );
          const a = repo.commit("a");
          git(repo.dir, "checkout", "-qb", "feature/b", repo.base);
          yield* Effect.promise(() =>
            NodeFSP.writeFile(
              NodePath.join(repo.dir, "pay.txt"),
              "B\n" + "same\n".repeat(20) + "last\n",
            ),
          );
          const b = repo.commit("b");
          const before = [
            git(repo.dir, "count-objects", "-v"),
            git(repo.dir, "show-ref"),
            git(repo.dir, "status", "--porcelain"),
            yield* Effect.promise(() => NodeFSP.readFile(NodePath.join(repo.dir, ".git", "index"))),
          ];
          const scratch = NodePath.join(repo.dir, "scratch");
          yield* Effect.gen(function* () {
            const runner = createGit(yield* VcsProcess.VcsProcess, scratch);
            yield* runner.sweepScratch();
            const info = yield* runner.discoverRepository(repo.dir);
            const answer = yield* runner.withScratch((objects) =>
              Effect.gen(function* () {
                const mode = yield* Effect.promise(() => NodeFSP.stat(objects));
                expect(mode.mode & 0o777).toBe(0o700);
                return yield* runner.mergeTree(info, objects, a, b);
              }),
            );
            expect(answer).toEqual({ state: "conflict", files: ["pay.txt"], more: 0 });
          }).pipe(Effect.provide(live));
          expect(yield* Effect.promise(() => NodeFSP.readdir(scratch))).toEqual([]);
          expect([
            git(repo.dir, "count-objects", "-v"),
            git(repo.dir, "show-ref"),
            git(repo.dir, "status", "--porcelain"),
            yield* Effect.promise(() => NodeFSP.readFile(NodePath.join(repo.dir, ".git", "index"))),
          ]).toEqual(before);
        } finally {
          yield* Effect.promise(() => repo.dispose());
        }
      }),
  );
});
