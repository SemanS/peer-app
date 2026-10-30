// @effect-diagnostics nodeBuiltinImport:off - the diff is read from real repositories on disk.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  changeToReview,
  type DiffInput,
  pushedRefs,
  readPatch,
  roomDiff,
  workRun,
  worktreeOf,
} from "./client/diff.ts";

const git = (cwd: string, ...args: string[]) =>
  NodeChildProcess.execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();

/** A bare origin and a clone of it on `main`, removed with the test's scope. */
const repositories = Effect.acquireRelease(
  Effect.sync(() => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-rooms-"));
    const origin = NodePath.join(dir, "origin.git");
    const work = NodePath.join(dir, "work");
    NodeFS.mkdirSync(origin);
    git(origin, "init", "--bare", "-b", "main");
    git(dir, "clone", "-q", origin, work);
    git(work, "checkout", "-q", "-b", "main");
    NodeFS.writeFileSync(NodePath.join(work, "a.txt"), "one\ntwo\n");
    git(work, "add", ".");
    git(work, "commit", "-qm", "first");
    git(work, "push", "-q", "origin", "main");
    return { dir, origin, work };
  }),
  ({ dir }) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
);

const scoped = <A, E, R>(test: Effect.Effect<A, E, R>) => Effect.scoped(test);

const input = (over: Partial<DiffInput>): DiffInput => ({
  root: undefined,
  base: "main",
  checkout: undefined,
  handoffs: [],
  threads: [],
  files: [],
  nameOf: () => "Ana",
  ...over,
});

/** Ana's branch, pushed from another clone. */
const pushedBranch = (origin: string, dir: string) => {
  const hers = NodePath.join(dir, "hers");
  git(dir, "clone", "-q", origin, hers);
  git(hers, "checkout", "-q", "-b", "ana/tax");
  NodeFS.writeFileSync(NodePath.join(hers, "a.txt"), "one\ntwo\nthree\n");
  git(hers, "commit", "-qam", "tax");
  git(hers, "push", "-q", "origin", "ana/tax");
  return git(hers, "rev-parse", "HEAD");
};

describe("the run a diff reads", () => {
  const sessions = [{ run: "run_review", root: "/review", repositoryId: "api" }];

  it("passes over a review run, newest or not", () => {
    assert.deepStrictEqual(
      workRun({
        runs: [
          { id: "run_review", keys: [] },
          { id: "run_work", keys: [] },
        ],
        reviews: new Set(["run_review"]),
        sessions: [...sessions, { run: "run_work", root: "/work", repositoryId: "web" }],
        threads: [],
      }),
      { root: "/work", repository: "web" },
    );
  });

  it("finds a detached run by its thread's branch", () => {
    assert.deepStrictEqual(
      workRun({
        runs: [{ id: "run_work", keys: ["herdr:t1"] }],
        reviews: new Set(),
        sessions: [],
        threads: [{ id: "herdr:t1", branch: "ana/tax" }],
      }),
      { branch: "ana/tax" },
    );
  });

  it.effect("finds that branch's worktree", () =>
    scoped(
      Effect.gen(function* () {
        const { dir, work } = yield* repositories;
        const tree = NodePath.join(dir, "tree");
        git(work, "worktree", "add", "-q", "-b", "ana/tax", tree);
        const found = yield* Effect.promise(() => worktreeOf(work, "ana/tax"));
        assert.strictEqual(NodeFS.realpathSync(found ?? ""), NodeFS.realpathSync(tree));
        assert.isUndefined(yield* Effect.promise(() => worktreeOf(work, "ana/other")));
      }),
    ),
  );
});

describe("the change a review session starts on", () => {
  it.effect("is the first ref on the remote, fetched as its remote branch", () =>
    scoped(
      Effect.gen(function* () {
        const { dir, origin, work } = yield* repositories;
        const head = pushedBranch(origin, dir);
        const change = yield* Effect.promise(() => changeToReview(work, ["gone", "ana/tax"]));
        assert.deepStrictEqual(change, { ref: "ana/tax", base: "origin/ana/tax" });
        assert.strictEqual(git(work, "rev-parse", "origin/ana/tax"), head);
      }),
    ),
  );

  it.effect("is nothing when no ref is on the remote", () =>
    scoped(
      Effect.gen(function* () {
        const { work } = yield* repositories;
        assert.isUndefined(yield* Effect.promise(() => changeToReview(work, ["gone"])));
      }),
    ),
  );

  it("looks at handoffs first and never at the base", () => {
    assert.deepStrictEqual(
      pushedRefs(
        [
          { delivery: { evidence: { branch: "old" } } },
          { delivery: { evidence: { branch: "new" } } },
        ],
        [
          { branch: "main", email: "a" },
          { branch: "old", email: "a" },
          { branch: "thread", email: "a" },
        ],
        "main",
      ),
      ["new", "old", "thread"],
    );
  });
});

describe("the room's diff", () => {
  it.effect("is this computer's run's checkout against the merge base, uncommitted included", () =>
    scoped(
      Effect.gen(function* () {
        const { work } = yield* repositories;
        git(work, "checkout", "-q", "-b", "mine");
        NodeFS.writeFileSync(NodePath.join(work, "b.txt"), "committed\n");
        git(work, "add", ".");
        git(work, "commit", "-qm", "mine");
        NodeFS.writeFileSync(NodePath.join(work, "a.txt"), "one\nchanged\n");
        const head = git(work, "rev-parse", "HEAD");
        const base = git(work, "rev-parse", "origin/main");
        const diff = yield* roomDiff(input({ root: work }));
        assert.strictEqual(diff.state, "here");
        if (diff.state !== "here") return;
        assert.strictEqual(diff.source, "run");
        assert.strictEqual(diff.head, head);
        assert.strictEqual(diff.base, base);
        assert.include(diff.patch, "+changed");
        assert.include(diff.patch, "+committed");
        assert.isFalse(diff.truncated);
      }),
    ),
  );

  it.effect("fetches a pushed ref, leaving the working tree as it was", () =>
    scoped(
      Effect.gen(function* () {
        const { dir, origin, work } = yield* repositories;
        const head = pushedBranch(origin, dir);
        NodeFS.writeFileSync(NodePath.join(work, "a.txt"), "local edit\n");
        const status = git(work, "status", "--porcelain");
        const branch = git(work, "rev-parse", "--abbrev-ref", "HEAD");
        const diff = yield* roomDiff(
          input({
            checkout: { path: work },
            handoffs: [{ delivery: { evidence: { branch: "ana/tax" } } }],
          }),
        );
        assert.strictEqual(diff.state, "here");
        if (diff.state !== "here") return;
        assert.strictEqual(diff.source, "pushed");
        assert.strictEqual(diff.head, head);
        assert.include(diff.patch, "+three");
        assert.strictEqual(git(work, "status", "--porcelain"), status);
        assert.strictEqual(git(work, "rev-parse", "--abbrev-ref", "HEAD"), branch);
        assert.strictEqual(
          NodeFS.readFileSync(NodePath.join(work, "a.txt"), "utf8"),
          "local edit\n",
        );
      }),
    ),
  );

  it.effect("uses a reported session's branch when no handoff names one", () =>
    scoped(
      Effect.gen(function* () {
        const { dir, origin, work } = yield* repositories;
        pushedBranch(origin, dir);
        const diff = yield* roomDiff(
          input({
            checkout: { path: work },
            threads: [{ branch: "ana/tax", email: "ana@acme.test" }],
          }),
        );
        assert.strictEqual(diff.state, "here");
      }),
    ),
  );

  it.effect("never gives git an unsafe ref", () =>
    scoped(
      Effect.gen(function* () {
        const { work } = yield* repositories;
        const diff = yield* roomDiff(
          input({
            checkout: { path: work },
            threads: [{ branch: "--upload-pack=touch /tmp/pwned", email: "ana@acme.test" }],
          }),
        );
        assert.strictEqual(diff.state, "notHere");
      }),
    ),
  );

  it.effect("leaves the person's FETCH_HEAD alone, in a private ref", () =>
    scoped(
      Effect.gen(function* () {
        const { dir, origin, work } = yield* repositories;
        const head = pushedBranch(origin, dir);
        const mine = NodePath.join(work, ".git", "FETCH_HEAD");
        NodeFS.writeFileSync(mine, "theirs\n");
        yield* roomDiff(
          input({
            checkout: { path: work },
            threads: [{ branch: "ana/tax", email: "ana@acme.test" }],
          }),
        );
        assert.strictEqual(NodeFS.readFileSync(mine, "utf8"), "theirs\n");
        assert.include(git(work, "for-each-ref", "refs/peer/rooms"), head);
      }),
    ),
  );

  it.effect("looks past a run with nothing in it to the pushed work", () =>
    scoped(
      Effect.gen(function* () {
        const { dir, origin, work } = yield* repositories;
        pushedBranch(origin, dir);
        git(work, "checkout", "-q", "-b", "empty");
        const diff = yield* roomDiff(
          input({
            root: work,
            checkout: { path: work },
            threads: [{ branch: "ana/tax", email: "ana@acme.test" }],
          }),
        );
        assert.strictEqual(diff.state === "here" && diff.source, "pushed");
      }),
    ),
  );

  it.effect("answers with an empty diff when nothing better turns up", () =>
    scoped(
      Effect.gen(function* () {
        const { work } = yield* repositories;
        git(work, "checkout", "-q", "-b", "empty");
        const diff = yield* roomDiff(input({ root: work, checkout: { path: work } }));
        assert.strictEqual(diff.state === "here" && diff.patch, "");
      }),
    ),
  );

  it.effect("shows a run on the base branch: what is uncommitted and what is not pushed", () =>
    scoped(
      Effect.gen(function* () {
        const { work } = yield* repositories;
        const pushed = git(work, "rev-parse", "HEAD");
        NodeFS.writeFileSync(NodePath.join(work, "a.txt"), "one\ntwo\nunpushed\n");
        git(work, "commit", "-qam", "not pushed");
        NodeFS.appendFileSync(NodePath.join(work, "a.txt"), "uncommitted\n");
        const diff = yield* roomDiff(input({ root: work }));
        assert.strictEqual(diff.state, "here");
        if (diff.state !== "here") return;
        assert.strictEqual(diff.source, "run");
        assert.strictEqual(diff.base, pushed);
        assert.include(diff.patch, "+unpushed");
        assert.include(diff.patch, "+uncommitted");
      }),
    ),
  );

  it.effect("a run on the base branch with nothing new falls through to a pushed ref", () =>
    scoped(
      Effect.gen(function* () {
        const { dir, origin, work } = yield* repositories;
        pushedBranch(origin, dir);
        const diff = yield* roomDiff(
          input({
            root: work,
            checkout: { path: work },
            threads: [{ branch: "ana/tax", email: "ana@acme.test" }],
          }),
        );
        assert.strictEqual(diff.state, "here");
        if (diff.state === "here") assert.strictEqual(diff.source, "pushed");
      }),
    ),
  );

  it.effect("never takes the base for a pushed ref", () =>
    scoped(
      Effect.gen(function* () {
        const { work } = yield* repositories;
        const diff = yield* roomDiff(
          input({
            checkout: { path: work },
            threads: [{ branch: "main", email: "ana@acme.test" }],
          }),
        );
        assert.strictEqual(diff.state, "notHere");
      }),
    ),
  );

  it.effect("tells a remote it could not reach from work that was not pushed", () =>
    scoped(
      Effect.gen(function* () {
        const { work, dir } = yield* repositories;
        git(work, "remote", "set-url", "origin", NodePath.join(dir, "gone.git"));
        const diff = yield* roomDiff(
          input({
            checkout: { path: work },
            threads: [{ branch: "ana/tax", email: "ana@acme.test" }],
          }),
        );
        assert.strictEqual(diff.state, "notHere");
        if (diff.state !== "notHere") return;
        assert.notInclude(diff.reason, "has not been pushed");
        assert.include(diff.reason, "cannot tell whether Ana's work is pushed");
      }),
    ),
  );

  it.effect("says the work is not here, with the paths the Hub knows", () =>
    scoped(
      Effect.gen(function* () {
        const { work } = yield* repositories;
        const diff = yield* roomDiff(
          input({
            checkout: { path: work },
            threads: [{ branch: "ana/unpushed", email: "ana@acme.test" }],
            handoffs: [{ delivery: { evidence: { uncommitted: ["b.ts"], untracked: ["c.ts"] } } }],
            files: ["a.ts", "b.ts"],
          }),
        );
        assert.deepStrictEqual(diff, {
          state: "notHere",
          reason: "Ana's work has not been pushed. Watch it, or ask their agent to push.",
          files: ["a.ts", "b.ts", "c.ts"],
        });
      }),
    ),
  );

  it.effect("says so without a checkout", () =>
    Effect.gen(function* () {
      const diff = yield* roomDiff(input({ threads: [{ branch: "x", email: "ana@acme.test" }] }));
      assert.strictEqual(diff.state, "notHere");
      if (diff.state === "notHere") assert.include(diff.reason, "no checkout");
    }),
  );

  it.effect("cuts a large diff at a line, and says so", () =>
    scoped(
      Effect.gen(function* () {
        const { work } = yield* repositories;
        NodeFS.writeFileSync(
          NodePath.join(work, "a.txt"),
          Array.from({ length: 2000 }, (_, at) => `line ${at}`).join("\n"),
        );
        const full = yield* Effect.promise(() => readPatch(work, ["diff"]));
        assert.isFalse(full.truncated);
        const cut = yield* Effect.promise(() => readPatch(work, ["diff"], 1024));
        assert.isTrue(cut.truncated);
        assert.isAtMost(Buffer.byteLength(cut.patch), 1024);
        assert.isTrue(cut.patch.endsWith("\n"));
      }),
    ),
  );

  it.effect("holds a real diff to the 512 KiB limit", () =>
    scoped(
      Effect.gen(function* () {
        const { work } = yield* repositories;
        git(work, "checkout", "-q", "-b", "mine");
        NodeFS.writeFileSync(NodePath.join(work, "a.txt"), `${"x".repeat(200)}\n`.repeat(4000));
        const diff = yield* roomDiff(input({ root: work }));
        assert.strictEqual(diff.state, "here");
        if (diff.state !== "here") return;
        assert.isTrue(diff.truncated);
        assert.isAtMost(Buffer.byteLength(diff.patch), 512 * 1024);
      }),
    ),
  );
});
