// @effect-diagnostics nodeBuiltinImport:off - the diff is read from real repositories on disk.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { type DiffInput, readPatch, roomDiff } from "./client/diff.ts";

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
