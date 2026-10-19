import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  changeIdOf,
  changesPeer,
  commitIdOf,
  git,
  hubRow,
  jj,
  jjHome,
  refusedWith,
  rpcOver,
  team,
  write,
} from "./fixtures.test.ts";
import { parseGitDiff } from "./client/review.ts";

const home = jjHome();
const STRANGER = "9".repeat(40);

/**
 * Ana's ORD-11 in three versions, as her computer pushed them: v1 (the base she wrote), v2 (the
 * same change rebased onto main, which gained two commits) and v3 (an edit). Bob has fetched v1 only.
 */
function threeVersions(through: 2 | 3 = 3) {
  const t = team(home);
  jj("ana", t.ana, "new", "main", "-m", "ORD-11: receipt totals in cents");
  write(t.ana, "order.js", "export const total = 1;\nexport const cents = 100;\n");
  jj("ana", t.ana, "bookmark", "create", "ana-ord-11", "-r", "@");
  jj("ana", t.ana, "git", "push", "-b", "ana-ord-11");
  const v1 = commitIdOf("ana", t.ana, "ana-ord-11");
  const changeId = changeIdOf("ana", t.ana, "ana-ord-11");
  jj("bob", t.bob, "git", "fetch");

  for (const file of ["extra1.js", "extra2.js"]) {
    write(t.seed, file, "export const x = 1;\n");
    git(t.seed, "add", ".");
    git(t.seed, "commit", "--quiet", "-m", file);
    git(t.seed, "push", "--quiet", "origin", "HEAD:main");
  }
  jj("ana", t.ana, "git", "fetch");
  jj("ana", t.ana, "rebase", "-b", "ana-ord-11", "-o", "main@origin");
  jj("ana", t.ana, "git", "push", "-b", "ana-ord-11");
  const v2 = commitIdOf("ana", t.ana, "ana-ord-11");

  if (through === 2) return { t, changeId, v: [v1, v2, v2] as const };
  write(
    t.ana,
    "order.js",
    "export const total = 1;\nexport const cents = 100;\nexport const toEuros = (c) => c / 100;\n",
  );
  jj("ana", t.ana, "status");
  jj("ana", t.ana, "git", "push", "-b", "ana-ord-11");
  const v3 = commitIdOf("ana", t.ana, "ana-ord-11");
  return { t, changeId, v: [v1, v2, v3] as const };
}

const versionsOf = (commits: ReadonlyArray<string>) =>
  commits.map((commit, at) => ({
    commit,
    at: `2026-10-18T14:3${at}:00.000Z`,
    kind: at === 1 ? "rebase" : "edit",
  }));

const place = { workspace: "acme", project: "app" };

describe("review marks and the diff since them", () => {
  it.live(
    "show only what moved since the mark, leave a rebase out, and keep a hidden commit readable",
    () =>
      Effect.gen(function* () {
        const { t, changeId, v } = threeVersions();
        const row = hubRow({ changeId, commitId: v[2], versions: versionsOf(v) });
        const { peer } = yield* changesPeer({ rows: [row], features: { changes: 1 } }, t.bob);
        const rpc = yield* rpcOver(peer.plugins);

        const mark = yield* rpc["peer.changes.markReviewed"]({
          ...place,
          changeId,
          commit: v[0],
          version: 1,
        });
        assert.strictEqual(mark?.commit, v[0]);
        assert.strictEqual(git(t.bob, "rev-parse", `refs/peer/reviewed/${changeId}`).trim(), v[0]);

        // Ana rewrote the change; Bob's jj hides the version he marked.
        jj("bob", t.bob, "git", "fetch");
        const hidden = jj(
          "bob",
          t.bob,
          "log",
          "--no-graph",
          "-r",
          `visible_heads() & ${v[0]}`,
          "-T",
          "commit_id",
        ).trim();
        assert.strictEqual(hidden, "");

        const since = yield* rpc["peer.changes.reviewDiff"]({ ...place, changeId, mode: "since" });
        assert.strictEqual(since.state, "ok");
        assert.strictEqual(since.fromVersion, 1);
        assert.strictEqual(since.toVersion, 3);
        assert.strictEqual(
          since.command,
          `jj interdiff --from ${v[0].slice(0, 8)} --to ${changeId.slice(0, 8)}`,
        );
        assert.deepStrictEqual(
          since.files.map((file) => [file.path, file.added, file.removed]),
          [["order.js", 1, 0]],
        );
        assert.isTrue(
          since.files[0]!.lines.some(
            (l) => l.kind === "add" && l.text === "export const toEuros = (c) => c / 100;",
          ),
        );
        assert.strictEqual(since.leftOut, 2);

        const whole = yield* rpc["peer.changes.reviewDiff"]({ ...place, changeId, mode: "whole" });
        assert.strictEqual(whole.command, `jj diff -r ${changeId.slice(0, 8)}`);
        assert.deepStrictEqual(
          whole.files.map((file) => [file.path, file.added]),
          [["order.js", 2]],
        );

        // The task page's own base: the version it last built on.
        const fromTwo = yield* rpc["peer.changes.reviewDiff"]({
          ...place,
          changeId,
          mode: "whole",
          from: v[0],
        });
        assert.strictEqual(fromTwo.fromVersion, 1);
        assert.deepStrictEqual(
          fromTwo.files.map((file) => [file.path, file.added]),
          [["order.js", 1]],
        );
        const unknown = yield* rpc["peer.changes.reviewDiff"]({
          ...place,
          changeId,
          mode: "whole",
          from: v[1],
        });
        assert.strictEqual(unknown.command, whole.command);

        // The view carries the mark; taking it back clears the pin and the mark.
        const view = yield* rpc["peer.changes.subscribe"](place).pipe(
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        );
        assert.deepStrictEqual(
          view.marks.map((m) => [m.changeId, m.commit, m.version]),
          [[changeId, v[0], 1]],
        );
        assert.strictEqual(view.landed?.bookmark, "main@origin");
        assert.isNull(
          yield* rpc["peer.changes.markReviewed"]({
            ...place,
            changeId,
            commit: v[0],
            version: 1,
            unmark: true,
          }),
        );
        assert.throws(() => git(t.bob, "rev-parse", "--verify", `refs/peer/reviewed/${changeId}`));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("add no lines for a version that only rebased", () =>
    Effect.gen(function* () {
      const { t, changeId, v } = threeVersions(2);
      const row = hubRow({ changeId, commitId: v[1], versions: versionsOf([v[0], v[1]]) });
      const { peer } = yield* changesPeer({ rows: [row], features: { changes: 1 } }, t.bob);
      const rpc = yield* rpcOver(peer.plugins);
      yield* rpc["peer.changes.markReviewed"]({ ...place, changeId, commit: v[0], version: 1 });
      jj("bob", t.bob, "git", "fetch");
      const since = yield* rpc["peer.changes.reviewDiff"]({ ...place, changeId, mode: "since" });
      assert.deepStrictEqual(since.files, []);
      assert.strictEqual(since.leftOut, 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("compare up to the newest version this computer has, and say when it has none", () =>
    Effect.gen(function* () {
      const { t, changeId, v } = threeVersions();
      const partialRow = hubRow({ changeId, versions: versionsOf([v[0], v[2], STRANGER]) });
      const script = { rows: [partialRow], features: { changes: 1 } };
      const { peer } = yield* changesPeer(script, t.bob);
      const rpc = yield* rpcOver(peer.plugins);
      jj("bob", t.bob, "git", "fetch");
      const partial = yield* rpc["peer.changes.reviewDiff"]({ ...place, changeId, mode: "whole" });
      assert.strictEqual(partial.state, "partial");
      assert.strictEqual(partial.toVersion, 2);

      script.rows = [hubRow({ changeId, versions: versionsOf([STRANGER]) })];
      yield* peer.client.me;
      const missing = yield* rpc["peer.changes.markReviewed"]({
        ...place,
        changeId,
        commit: STRANGER,
        version: 1,
      }).pipe(refusedWith);
      assert.include(missing.detail, "not on this computer");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("parseGitDiff", () => {
  it("keeps a line's text without its marker, numbered on its own side", () => {
    const [file] = parseGitDiff(
      [
        "diff --git a/src/orders.js b/src/orders.js",
        "--- a/src/orders.js",
        "+++ b/src/orders.js",
        "@@ -1,2 +1,2 @@",
        "-/** An order's total in euros. */",
        "+/** An order's total in integer cents. */",
        " export const orderTotal = (order) =>",
        "",
      ].join("\n"),
    );
    assert.deepStrictEqual(file?.lines, [
      { kind: "del", n: 1, text: "/** An order's total in euros. */" },
      { kind: "add", n: 1, text: "/** An order's total in integer cents. */" },
      { kind: "context", n: 2, text: "export const orderTotal = (order) =>" },
    ]);
  });
});
