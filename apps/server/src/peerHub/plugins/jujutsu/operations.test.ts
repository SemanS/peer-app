// @effect-diagnostics nodeBuiltinImport:off - real jj in temporary repositories.
/**
 * Undo and the operation log (design D7) on a real jj, reproducing fact 8: reverting one agent's
 * restore after a later operation rebased the same change leaves it with two versions, and converge
 * brings the file back on the newest parent.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { PeerSessionView } from "../../core/plugin.ts";
import * as Effect from "effect/Effect";

import { OPERATIONS_MAX, parseOperations, previewOf } from "./client/operations.ts";
import { bobsJujutsu, isolatedHome, jj, repository, sessionIn, stepOf } from "./fixtures.test.ts";

isolatedHome();
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const write = (dir: string, file: string, text: string) =>
  NodeFS.writeFileSync(NodePath.join(dir, file), text);
const changeOf = (cwd: string, rev: string) =>
  jj(cwd, "log", "--no-graph", "--ignore-working-copy", "-r", rev, "-T", "change_id").trim();
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
const place = { workspace: "acme", project: "pay" };
const headOperation = (cwd: string) =>
  jj(cwd, "op", "log", "--no-graph", "--ignore-working-copy", "-n", "1", "-T", "id");

/**
 * Bob's person works in the repository's default workspace; his agent in `ORD-12-3f2a1b2c`, on a
 * change above Ana's ORD-11, which Ana's agent amends later.
 */
const scenario = Effect.gen(function* () {
  const repo = repository();
  write(repo.main, "order.js", "export const total = 100;\n");
  jj(repo.main, "describe", "-m", "ORD-11");
  const ana = changeOf(repo.main, "@");
  const agent = repo.workspace("ORD-12-3f2a1b2c");
  jj(agent, "new", ana, "-m", "ORD-12");
  const sessions: Array<PeerSessionView> = [];
  const bob = yield* bobsJujutsu({ sessions });
  yield* bob.state.updatePersisted((persisted) => ({
    ...persisted,
    localCheckouts: { "acme/pay/api": repo.main },
  }));
  const session = sessionIn(agent, { task: "t12" });
  sessions.push(session);
  yield* bob.service.sessionStart(session);
  const step = () => bob.service.afterStep(stepOf(session, { remainingMs: 15_000 }));
  return { ...repo, agent, ana, session, step, ...bob };
});

/** The agent wrote `loyalty.js`, then restored it away; Ana's agent amended the change under it. */
const afterRestore = Effect.gen(function* () {
  const world = yield* scenario;
  write(world.agent, "loyalty.js", "export const points = 1;\n");
  yield* world.step();
  const mine = changeOf(world.agent, "@");
  jj(world.agent, "restore", "--from", "main", "loyalty.js");
  write(world.main, "order.js", "export const total = 100; // cents\n");
  jj(world.main, "util", "snapshot");
  return { ...world, mine };
});

describe("the operation log", () => {
  it.effect(
    "lists steps newest first with who took them, the workspace and what they changed",
    () =>
      Effect.gen(function* () {
        const { service, mine } = yield* afterRestore;

        const listed = yield* service.operations(place);

        const restore = listed.operations.find((one) =>
          one.description.startsWith("restore into commit"),
        );
        assert.strictEqual(restore?.user, "bob·codex");
        assert.strictEqual(restore?.workspace, "ORD-12-3f2a1b2c@");
        assert.strictEqual(restore?.args, "jj restore --from main loyalty.js");
        assert.isTrue(restore?.changed.some((id) => mine.startsWith(id)));
        assert.isAtMost(listed.operations.length, OPERATIONS_MAX);
        assert.isUndefined(listed.changedUnread);
        // Newest first: Ana's rewrite came after the restore.
        const order = listed.operations.map((one) => one.id);
        assert.isBelow(
          order.indexOf(
            listed.operations.find(
              (one) => one.user !== "bob·codex" && one.description === "snapshot working copy",
            )!.id,
          ),
          order.indexOf(restore!.id),
        );
      }).pipe(run),
  );
});

describe("undo", () => {
  it.effect("names the later step, then reverts and converges so the file is back", () =>
    Effect.gen(function* () {
      const { service, agent, mine, step, main } = yield* afterRestore;
      const restore = (yield* service.operations(place)).operations.find((one) =>
        one.description.startsWith("restore into commit"),
      )!;

      const preview = yield* service.previewUndo({ ...place, operation: restore.id });

      assert.strictEqual(preview.later.length, 1);
      assert.notStrictEqual(preview.later[0]!.user, "bob·codex");
      assert.isTrue(preview.shared.every((id) => mine.startsWith(id)));
      assert.deepStrictEqual(preview.commands, [
        `jj op revert ${restore.id}`,
        `jj converge --no-interactive -r change_id(${preview.shared[0]})`,
      ]);
      // Looking runs nothing.
      assert.strictEqual(versions(main, mine).length, 1);

      const done = yield* service.undo({ ...place, operation: restore.id });

      assert.deepStrictEqual(done.ran, preview.commands);
      assert.deepStrictEqual(done.converged, preview.shared);
      assert.deepStrictEqual(done.needsPerson, []);
      assert.strictEqual(versions(main, mine).length, 1);
      assert.strictEqual(
        jj(main, "file", "show", "-r", `change_id(${mine})`, "loyalty.js"),
        "export const points = 1;\n",
      );
      const newest = (yield* service.operations(place)).operations.slice(0, 2);
      assert.isTrue(newest.some((one) => one.args.includes("converge")));
      assert.isTrue(newest.some((one) => one.args.includes("op revert")));
      assert.isFalse(newest.some((one) => one.user.includes("·")));
      // Both steps are Bob's, not the computer user's.
      assert.deepStrictEqual(
        newest.map((one) => one.user),
        ["bob", "bob"],
      );

      // The agent hears it once, at its next step, and its files are back.
      const text = (yield* step()) ?? "";
      assert.include(text, "Bob undid your step restore into commit");
      assert.include(
        text,
        "(jj op revert). loyalty.js is back in your change. Re-read the files you edit.",
      );
      assert.strictEqual(
        NodeFS.readFileSync(NodePath.join(agent, "loyalty.js"), "utf8"),
        "export const points = 1;\n",
      );
      assert.isNull(yield* step());
    }).pipe(run),
  );

  it.effect("runs no converge when no later step touched the same changes", () =>
    Effect.gen(function* () {
      const { service, agent, step, main } = yield* scenario;
      write(agent, "notes.txt", "x\n");
      yield* step();
      const snapshot = (yield* service.operations(place)).operations.find(
        (one) => one.user === "bob·codex" && one.description === "snapshot working copy",
      )!;

      const preview = yield* service.previewUndo({ ...place, operation: snapshot.id });
      assert.deepStrictEqual(preview.later, []);
      assert.deepStrictEqual(preview.commands, [`jj op revert ${snapshot.id}`]);

      const done = yield* service.undo({ ...place, operation: snapshot.id });

      assert.deepStrictEqual(done.ran, [`jj op revert ${snapshot.id}`]);
      assert.deepStrictEqual(done.converged, []);
      const log = jj(
        main,
        "op",
        "log",
        "--no-graph",
        "--ignore-working-copy",
        "-T",
        "attributes.first_line() ++ '\\n'",
      );
      assert.notInclude(log, "converge");
    }).pipe(run),
  );

  it.effect("runs nothing for a step that is gone, and answers a failure in words", () =>
    Effect.gen(function* () {
      const { service, main } = yield* scenario;
      const before = headOperation(main);

      const failure = yield* service
        .undo({ ...place, operation: "ffffffffffff" })
        .pipe(Effect.flip);

      assert.include(failure.detail, "no longer among the newest 50");
      assert.strictEqual(headOperation(main), before);
    }).pipe(run),
  );
});

describe("the repository as it was", () => {
  it.effect("reads the changes right after an operation without changing anything", () =>
    Effect.gen(function* () {
      const { service, mine, main } = yield* afterRestore;
      const operations = (yield* service.operations(place)).operations;
      const at = operations.findIndex((one) => one.description.startsWith("restore into commit"));
      const before = headOperation(main);

      const then = yield* service.atOp({ ...place, operation: operations[at + 1]!.id });
      const after = yield* service.atOp({ ...place, operation: operations[at]!.id });

      const row = (rows: typeof then.rows) =>
        rows.find((one) => one.changeId.startsWith(mine.slice(0, 8)));
      assert.deepStrictEqual(row(then.rows)?.paths, ["loyalty.js"]);
      assert.strictEqual(row(then.rows)?.subject, "ORD-12");
      assert.deepStrictEqual(row(after.rows)?.paths, []);
      assert.strictEqual(headOperation(main), before);
    }).pipe(run),
  );
});

describe("converge, from the Changes page", () => {
  it.effect("merges a change's two versions and says one remains", () =>
    Effect.gen(function* () {
      const { service, main, mine } = yield* afterRestore;
      const restore = (yield* service.operations(place)).operations.find((one) =>
        one.description.startsWith("restore into commit"),
      )!;
      jj(main, "op", "revert", restore.id);
      assert.strictEqual(versions(main, mine).length, 2);

      const done = yield* service.converge({ ...place, change: mine });

      assert.deepStrictEqual(done, { resolved: true });
      assert.strictEqual(versions(main, mine).length, 1);
    }).pipe(run),
  );
});

describe("integrating two changes", () => {
  it.effect(
    "makes a change on both without rewriting either, with the bookmark for the later task",
    () =>
      Effect.gen(function* () {
        const repo = repository();
        jj(repo.main, "new", "main", "-m", "ORD-11");
        write(repo.main, "order.js", "export const total = 100;\n");
        jj(repo.main, "bookmark", "set", "feature/ORD-11-cents", "-r", "@");
        jj(repo.main, "new", "main", "-m", "ORD-14");
        write(repo.main, "order.js", "export const total = 119;\n");
        jj(repo.main, "bookmark", "set", "feature/ORD-14-vat", "-r", "@");
        const a = changeOf(repo.main, "feature/ORD-11-cents");
        const b = changeOf(repo.main, "feature/ORD-14-vat");
        const commits = [versions(repo.main, a), versions(repo.main, b)];
        const { service, state } = yield* bobsJujutsu();
        yield* state.updatePersisted((persisted) => ({
          ...persisted,
          localCheckouts: { "acme/pay/api": repo.main },
        }));

        const made = yield* service.integrate({
          ...place,
          a: { task: "ORD-11", rev: "feature/ORD-11-cents" },
          b: { task: "ORD-14", rev: b },
          later: "b",
        });

        assert.strictEqual(made.bookmark, "peer/integrate/ORD-11-ORD-14");
        assert.strictEqual(made.task, "ORD-14");
        assert.strictEqual(
          changeOf(repo.main, "peer/integrate/ORD-11-ORD-14"),
          changeOf(repo.main, `change_id(${made.change})`),
        );
        const parents = jj(
          repo.main,
          "log",
          "--no-graph",
          "--ignore-working-copy",
          "-r",
          `parents(change_id(${made.change}))`,
          "-T",
          'change_id ++ "\\n"',
        );
        assert.sameMembers(parents.trim().split("\n"), [a, b]);
        assert.include(
          jj(
            repo.main,
            "log",
            "--no-graph",
            "--ignore-working-copy",
            "-r",
            `change_id(${made.change})`,
            "-T",
            "description",
          ),
          "Integrate ORD-11 + ORD-14",
        );
        assert.deepStrictEqual([versions(repo.main, a), versions(repo.main, b)], commits);
      }).pipe(run),
  );
});

/** What `jj op log --op-diff` prints under jj 0.46.0, as `client/operations.ts` asks for it. */
const FIXTURE = [
  '@@OP 00b900515fbe\t2026-10-18T18:08:49+02:00\tbob·codex@inv-1068.local\tdefault@\t"snapshot working copy"\t"args: jj util snapshot"',
  "",
  "Changed commits:",
  "+ lwxvunqm d2b92b7e ORD-12: loyalty",
  "- lwxvunqm/1 f75f4472 (hidden) ORD-12: loyalty",
  "+ wqzoropk aab8c8b6 (empty) ORD-13",
  "",
  "Changed working copy default@:",
  "+ lwxvunqm d2b92b7e ORD-12: loyalty",
  "- lwxvunqm/1 f75f4472 (hidden) ORD-12: loyalty",
  '@@OP 42beecb47179\t2026-10-18T18:07:27+02:00\thotovo@inv-1068.local\tbob-codex@\t"fetch from git remote(s) origin"\t"args: jj git fetch -b x"',
  "",
  "Changed remote bookmarks:",
  "feature/x@origin: untracked",
  "",
].join("\n");

describe("the 'Changed commits' parser", () => {
  it("reads jj 0.46.0's lines: ids once, the person without the host, the command as recorded", () => {
    const parsed = parseOperations(FIXTURE);

    assert.isFalse(parsed.unread);
    assert.deepStrictEqual(parsed.operations, [
      {
        id: "00b900515fbe",
        time: "2026-10-18T18:08:49+02:00",
        user: "bob·codex",
        workspace: "default@",
        description: "snapshot working copy",
        args: "jj util snapshot",
        changed: ["lwxvunqm", "wqzoropk"],
      },
      {
        id: "42beecb47179",
        time: "2026-10-18T18:07:27+02:00",
        user: "hotovo",
        workspace: "bob-codex@",
        description: "fetch from git remote(s) origin",
        args: "jj git fetch -b x",
        changed: [],
      },
    ]);
  });

  it("degrades to 'could not read' when the lines change shape, and the undo still previews", () => {
    const changed = FIXTURE.replace(
      "+ lwxvunqm d2b92b7e ORD-12: loyalty\n- lwxvunqm/1",
      "* lwxvunqm: d2b92b7e ORD-12: loyalty\n- lwxvunqm/1",
    );

    const parsed = parseOperations(changed);

    assert.isTrue(parsed.unread);
    assert.deepStrictEqual(parsed.operations[0]!.changed, []);
    const preview = previewOf(parsed, "00b900515fbe");
    assert.isTrue(preview?.changedUnread);
    assert.deepStrictEqual(preview?.commands, ["jj op revert 00b900515fbe"]);
  });

  it("finds the later steps that share a change, oldest first", () => {
    const parsed = parseOperations(
      [
        '@@OP aaaaaaaaaaaa\tt3\tana\tdefault@\t"rebase"\t"args: jj rebase"',
        "",
        "Changed commits:",
        "+ mmmmmmmm 11111111 x",
        "+ nnnnnnnn 22222222 y",
        '@@OP bbbbbbbbbbbb\tt2\tana\tdefault@\t"rebase"\t"args: jj rebase"',
        "",
        "Changed commits:",
        "+ nnnnnnnn 33333333 y",
        '@@OP cccccccccccc\tt1\tbob·codex\tbw@\t"restore"\t"args: jj restore"',
        "",
        "Changed commits:",
        "+ mmmmmmmm 44444444 x",
      ].join("\n"),
    );

    const preview = previewOf(parsed, "cccccccccccc")!;

    assert.deepStrictEqual(
      preview.later.map((one) => one.id),
      ["aaaaaaaaaaaa"],
    );
    assert.deepStrictEqual(preview.shared, ["mmmmmmmm"]);
    assert.strictEqual(previewOf(parsed, "dddddddddddd"), null);
  });
});
