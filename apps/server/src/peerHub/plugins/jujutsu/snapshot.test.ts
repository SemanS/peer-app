// @effect-diagnostics nodeBuiltinImport:off - real jj in temporary repositories.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { bobsJujutsu, isolatedHome, jj, repository, sessionIn, stepOf } from "./fixtures.test.ts";

isolatedHome();
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const write = (dir: string, file: string, text: string) =>
  NodeFS.writeFileSync(NodePath.join(dir, file), text);
const read = (dir: string, file: string) => NodeFS.readFileSync(NodePath.join(dir, file), "utf8");
const changeId = (cwd: string, rev: string) =>
  jj(cwd, "log", "--no-graph", "--ignore-working-copy", "-r", rev, "-T", "change_id");
const versions = (cwd: string, id: string) =>
  jj(
    cwd,
    "log",
    "--no-graph",
    "--ignore-working-copy",
    "-r",
    `change_id(${id})`,
    "-T",
    'commit_id ++ "\\n"',
  )
    .trim()
    .split("\n")
    .filter((line) => line !== "");

/** Ana's agent works in the default workspace; Bob's agent in `b`, on a change above hers. */
function stacked() {
  const repo = repository({ person: false });
  write(repo.main, "order.js", "export const total = 100;\n");
  jj(repo.main, "describe", "-m", "ORD-11");
  const ana = changeId(repo.main, "@");
  const b = repo.workspace("ORD-12-3f2a1b2c");
  jj(b, "new", ana, "-m", "ORD-12");
  return { ...repo, b, ana };
}

describe("the snapshot after a tool step", () => {
  it.effect("keeps an edit that a rewrite in another workspace overtook, in one version", () =>
    Effect.gen(function* () {
      const { main, b, ana } = stacked();
      const { service, logs } = yield* bobsJujutsu();
      const session = sessionIn(b);
      yield* service.sessionStart(session);
      const mine = changeId(b, "@");

      // Bob's agent wrote a file; jj has not seen it. Ana's agent amends the change it sits on.
      write(b, "loyalty.js", "export const points = 1;\n");
      write(main, "order.js", "export const total = 100; // cents\n");
      jj(main, "util", "snapshot");

      const text = yield* service.afterStep(stepOf(session));

      assert.deepStrictEqual(versions(b, mine).length, 1);
      assert.strictEqual(read(b, "loyalty.js"), "export const points = 1;\n");
      assert.strictEqual(read(b, "order.js"), "export const total = 100; // cents\n");
      assert.include(text ?? "", "merged two versions");
      assert.include(text ?? "", "Re-read the files you edit");
      assert.deepStrictEqual(service.twoVersions(session), []);
      assert.isTrue(
        logs.some(
          (entry) => entry.event === "jujutsu.converged" && entry.fields.outcome === "done",
        ),
      );
      assert.strictEqual(versions(b, ana).length, 1);

      // Nothing more to say at the next step.
      assert.isNull(yield* service.afterStep(stepOf(session)));
    }).pipe(run),
  );

  it.effect("takes the snapshot of an ordinary step and says nothing", () =>
    Effect.gen(function* () {
      const { b } = stacked();
      const { service, logs } = yield* bobsJujutsu();
      const session = sessionIn(b);
      yield* service.sessionStart(session);

      write(b, "loyalty.js", "x\n");
      assert.isNull(yield* service.afterStep(stepOf(session)));

      assert.include(jj(b, "diff", "--summary", "--ignore-working-copy", "-r", "@"), "loyalty.js");
      assert.isTrue(
        logs.some((entry) => entry.event === "jujutsu.snapshot" && entry.fields.changed === true),
      );
    }).pipe(run),
  );

  it.effect("leaves both versions and says so when jj cannot choose", () =>
    Effect.gen(function* () {
      const repo = repository({ person: false });
      const b = repo.workspace("ORD-12-aaaaaaaa");
      const { service } = yield* bobsJujutsu();
      const session = sessionIn(b);
      yield* service.sessionStart(session);

      // Two steps from the same operation moved the change onto different parents.
      jj(b, "new", "main", "-m", "P1");
      const p1 = changeId(b, "@");
      jj(b, "new", "main", "-m", "P2");
      const p2 = changeId(b, "@");
      jj(b, "new", "main", "-m", "Y");
      write(b, "y.txt", "y\n");
      jj(b, "util", "snapshot");
      const y = changeId(b, "@");
      const op = jj(
        b,
        "op",
        "log",
        "--limit",
        "1",
        "--no-graph",
        "--ignore-working-copy",
        "-T",
        "id.short(12)",
      ).trim();
      jj(b, `--at-op=${op}`, "rebase", "-r", y, "-o", p1);
      jj(b, `--at-op=${op}`, "rebase", "-r", y, "-o", p2);
      assert.strictEqual(versions(b, y).length, 2);

      const text = yield* service.afterStep(stepOf(session));

      assert.strictEqual(versions(b, y).length, 2);
      assert.deepStrictEqual(service.twoVersions(session), [y]);
      assert.include(text ?? "", "has two versions");
      assert.include(text ?? "", "Nothing is lost");
      assert.isTrue(text !== null && text.length <= 400);
      // Said once.
      assert.isNull(yield* service.afterStep(stepOf(session)));
    }).pipe(run),
  );

  it.live("logs a snapshot that misses its time, and the step goes on", () =>
    Effect.gen(function* () {
      const { b } = stacked();
      const { service, logs } = yield* bobsJujutsu();
      const session = sessionIn(b);
      yield* service.sessionStart(session);

      const text = yield* service.afterStep(stepOf(session, { remainingMs: 1 }));

      assert.isNull(text);
      assert.isTrue(logs.some((entry) => entry.event === "jujutsu.snapshot.late"));
      // The next step snapshots again.
      write(b, "loyalty.js", "x\n");
      yield* service.afterStep(stepOf(session));
      assert.include(jj(b, "diff", "--summary", "--ignore-working-copy", "-r", "@"), "loyalty.js");
    }).pipe(run),
  );

  it.effect("does nothing in a Git checkout", () =>
    Effect.gen(function* () {
      const repo = repository({ person: false });
      const git = NodePath.join(repo.dir, "plain");
      NodeFS.mkdirSync(git);
      const { service, logs } = yield* bobsJujutsu();
      const session = sessionIn(git);
      write(git, "a.txt", "a\n");

      assert.isNull(yield* service.afterStep(stepOf(session)));
      assert.deepStrictEqual(logs, []);
    }).pipe(run),
  );
});
