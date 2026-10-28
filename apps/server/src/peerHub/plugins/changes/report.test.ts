import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  bobOnAna,
  changesPeer,
  commitIdOf,
  eventually,
  hooks,
  jj,
  jjHome,
  puts,
  team,
  withdrawals,
  write,
} from "./fixtures.test.ts";

const home = jjHome();
const ready = { rows: [], features: { changes: 1 } };

describe("the report of a session's changes", () => {
  it.live("holds Bob's change on Ana's, never Ana's change as Bob's, and no file content", () =>
    Effect.gen(function* () {
      const t = team(home);
      const ids = bobOnAna(t);
      const { hub, fixture } = yield* changesPeer({ ...ready }, t.bob);
      yield* Effect.promise(() => hooks(fixture, t.bob).stop());
      const [first] = yield* eventually(
        () => puts(hub),
        (sent) => sent.length > 0,
      );
      const body = first!.body;
      assert.strictEqual(body.session, "claude:bob-1");
      assert.strictEqual(body.environment, "ana-laptop");
      assert.strictEqual(body.task, "ORD-12");
      assert.strictEqual(body.changes.length, 1);
      const change = body.changes[0]!;
      assert.deepStrictEqual(change, {
        changeId: ids.bobChange,
        commitId: ids.bobCommit,
        parents: [ids.ana],
        parentCommits: [ids.anaCommit],
        subject: "ORD-12: loyalty points",
        paths: ["loyalty.js"],
        bookmarks: [],
        conflict: false,
        empty: false,
        divergent: false,
        working: true,
        kind: "edit",
      });
      assert.notInclude(JSON.stringify(body), "points = (t)");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("reports a move onto Ana's newer version as a rebase, naming the commit it sits on", () =>
    Effect.gen(function* () {
      const t = team(home);
      const ids = bobOnAna(t);
      const { hub, fixture } = yield* changesPeer({ ...ready }, t.bob);
      const agent = hooks(fixture, t.bob);
      yield* Effect.promise(() => agent.stop());
      yield* eventually(
        () => puts(hub),
        (sent) => sent.length === 1,
      );
      // Ana amends her change and pushes; Bob's fetch moves his change onto the new version.
      write(
        t.ana,
        "order.js",
        "export const total = 100;\nexport const toEuros = (c) => c / 100;\n",
      );
      jj("ana", t.ana, "git", "push", "-b", "ana-ord-11");
      const amended = commitIdOf("ana", t.ana, "ana-ord-11");
      assert.notStrictEqual(amended, ids.anaCommit);
      jj("bob", t.bob, "git", "fetch");
      jj("bob", t.bob, "status");
      yield* Effect.promise(() => agent.stop());
      const sent = yield* eventually(
        () => puts(hub),
        (all) => all.length === 2,
      );
      const moved = sent[1]!.body.changes[0]!;
      assert.strictEqual(moved["kind"], "rebase");
      assert.deepStrictEqual(moved["parents"], [ids.ana]);
      assert.deepStrictEqual(moved["parentCommits"], [amended]);
      assert.notStrictEqual(moved["commitId"], ids.bobCommit);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("leaves Ana's change out even when it is not immutable here", () =>
    Effect.gen(function* () {
      const t = team(home);
      const ids = bobOnAna(t);
      // Tracking the bookmark makes Ana's change rewritable in Bob's repository; it is still hers.
      jj("bob", t.bob, "bookmark", "track", "ana-ord-11@origin");
      const { hub, fixture } = yield* changesPeer({ ...ready }, t.bob);
      yield* Effect.promise(() => hooks(fixture, t.bob).stop());
      const [first] = yield* eventually(
        () => puts(hub),
        (sent) => sent.length > 0,
      );
      assert.deepStrictEqual(
        first!.body.changes.map((change) => change["changeId"]),
        [ids.bobChange],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("names the kind of each new version, raises the seq, and withdraws at the end", () =>
    Effect.gen(function* () {
      const t = team(home);
      const ids = bobOnAna(t);
      const { hub, fixture } = yield* changesPeer({ ...ready }, t.bob);
      const agent = hooks(fixture, t.bob);
      yield* Effect.promise(() => agent.stop());
      yield* eventually(
        () => puts(hub),
        (sent) => sent.length === 1,
      );

      // Only the subject changed.
      jj("bob", t.bob, "describe", "-m", "ORD-12: loyalty points per euro");
      yield* Effect.promise(() => agent.stop());
      yield* eventually(
        () => puts(hub),
        (sent) => sent.length === 2,
      );
      // Edited.
      write(t.bob, "loyalty.js", "export const points = (t) => t / 5;\n");
      jj("bob", t.bob, "status");
      yield* Effect.promise(() => agent.stop());
      yield* eventually(
        () => puts(hub),
        (sent) => sent.length === 3,
      );
      // Only the parents changed: Ana amends her change and jj moves Bob's onto it.
      jj("bob", t.bob, "rebase", "-r", "@", "-o", "main");
      jj("bob", t.bob, "status");
      yield* Effect.promise(() => agent.stop());
      const sent = yield* eventually(
        () => puts(hub),
        (all) => all.length === 4,
      );

      assert.deepStrictEqual(
        sent.map((put) => put.body.changes[0]?.["kind"]),
        ["edit", "description", "edit", "rebase"],
      );
      assert.isTrue(sent.every((put, at) => at === 0 || put.body.seq > sent[at - 1]!.body.seq));
      assert.strictEqual(sent[0]!.body.changes[0]!["changeId"], ids.bobChange);

      yield* Effect.promise(() => agent.end());
      const gone = yield* eventually(
        () => withdrawals(hub),
        (all) => all.length > 0,
      );
      assert.deepStrictEqual(gone, [{ project: "app", session: "claude:bob-1" }]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("sends a step's report at most every 10 seconds, and a stop's at once", () =>
    Effect.gen(function* () {
      const t = team(home);
      bobOnAna(t);
      const { hub, fixture } = yield* changesPeer({ ...ready }, t.bob);
      const agent = hooks(fixture, t.bob);
      yield* Effect.promise(() => agent.step());
      yield* eventually(
        () => puts(hub),
        (sent) => sent.length === 1,
      );
      write(t.bob, "loyalty.js", "export const points = (t) => t / 2;\n");
      jj("bob", t.bob, "status");
      yield* Effect.promise(() => agent.step());
      yield* Effect.sleep("1500 millis");
      assert.strictEqual(puts(hub).length, 1);
      yield* Effect.promise(() => agent.stop());
      yield* eventually(
        () => puts(hub),
        (sent) => sent.length === 2,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live(
    "keeps trying while the Hub is down, and then the newest report is the one it takes",
    () =>
      Effect.gen(function* () {
        const t = team(home);
        bobOnAna(t);
        const script = { ...ready, down: true };
        const { hub, fixture } = yield* changesPeer(script, t.bob);
        const agent = hooks(fixture, t.bob);
        yield* Effect.promise(() => agent.stop());
        yield* eventually(
          () => puts(hub),
          (sent) => sent.length === 1,
        );
        jj("bob", t.bob, "describe", "-m", "ORD-12: loyalty points, newest");
        yield* Effect.promise(() => agent.stop());
        yield* eventually(
          () => puts(hub),
          (sent) => sent.length === 2,
        );
        script.down = false;
        jj("bob", t.bob, "describe", "-m", "ORD-12: loyalty points, newest of all");
        yield* Effect.promise(() => agent.stop());
        const sent = yield* eventually(
          () => puts(hub),
          (all) => all.length === 3,
        );
        assert.strictEqual(
          sent[2]!.body.changes[0]!["subject"],
          "ORD-12: loyalty points, newest of all",
        );
        assert.isAbove(sent[2]!.body.seq, sent[1]!.body.seq);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("continues from the Hub's seq when its own is behind", () =>
    Effect.gen(function* () {
      const t = team(home);
      bobOnAna(t);
      const script = {
        ...ready,
        route: ({ url, body }: { url: string; body: string }) =>
          url.endsWith("/changes/app") &&
          (JSON.parse(body) as { seq: number }).seq < 4_000_000_000_000
            ? ([
                409,
                {
                  error: { code: "stale_seq", message: "old", details: { seq: 4_000_000_000_000 } },
                },
              ] as const)
            : undefined,
      };
      const { hub, fixture } = yield* changesPeer(script, t.bob);
      yield* Effect.promise(() => hooks(fixture, t.bob).stop());
      const sent = yield* eventually(
        () => puts(hub),
        (all) => all.length === 2,
      );
      assert.strictEqual(sent[1]!.body.seq, 4_000_000_000_001);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
