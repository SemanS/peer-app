import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { PersistedRun } from "../state/PeerState.ts";
import * as PeerState from "../state/PeerState.ts";
import { coreLayer, paymentsSeed, seedState, standInHub } from "../testkit.ts";
import { mintRunId, RunBook, stateOf, workRunsOf } from "./runs.ts";
import * as PeerRuns from "./runs.ts";

const place = { workspace: "acme", project: "pay" };

/** A book over memory, its clock moved by hand, keeping what each write saved. */
function book(email: string | null = "ana@acme.test") {
  const clock = { now: Date.parse("2026-10-30T10:00:00Z") };
  const saved: Array<Readonly<Record<string, PersistedRun>>> = [];
  const runs = new RunBook(
    {},
    {
      environment: "ana-laptop",
      email: () => email,
      now: () => clock.now,
      save: async (next) => {
        saved.push(next);
      },
    },
  );
  return { runs, clock, saved };
}

describe("a run's id", () => {
  it("is run_ and 20 Crockford characters, ordered by its start", () => {
    const early = mintRunId(Date.parse("2026-10-30T10:00:00Z"), Buffer.alloc(7, 255));
    const late = mintRunId(Date.parse("2026-10-30T10:00:01Z"), Buffer.alloc(7, 0));
    assert.match(early, /^run_[0-9A-HJKMNP-TV-Z]{20}$/);
    assert.isBelow(early.localeCompare(late), 0);
  });
});

describe("RunBook", () => {
  it("create_is_idempotent_by_request", async () => {
    const { runs, clock } = book();
    const input = {
      ...place,
      task: "krk-1",
      agent: "codex",
      runtime: "herdr",
      requestId: "r-1",
    } as const;
    const first = await runs.create(input);
    const again = await runs.create(input);
    assert.isTrue(first.created);
    assert.isFalse(again.created);
    assert.strictEqual(again.run.id, first.run.id);
    // The retry gets the same token while this process holds it; only its hash is kept.
    assert.strictEqual(again.token, first.token);
    assert.notInclude(JSON.stringify(runs.get(first.run.id)), first.token!);
    assert.isTrue(runs.claim(first.run.id, first.token));
    assert.isFalse(runs.claim(first.run.id, "0".repeat(32)));
    clock.now += 25 * 60 * 60 * 1000;
    const later = await runs.create(input);
    assert.isTrue(later.created);
    assert.notStrictEqual(later.run.id, first.run.id);
  });

  it("attach_ends_the_previous_live_session", async () => {
    const { runs, clock } = book();
    const { run } = await runs.create({
      ...place,
      task: "krk-1",
      agent: "claude",
      runtime: "terminal",
    });
    await runs.attach(run.id, "claude:one");
    clock.now += 1000;
    const { replaced } = await runs.attach(run.id, "claude:two");
    assert.deepStrictEqual(replaced, ["claude:one"]);
    const now = runs.get(run.id)!;
    assert.strictEqual(stateOf(now), "running");
    assert.deepStrictEqual(
      now.sessions.map((s) => [s.id, s.to === undefined]),
      [
        ["claude:one", false],
        ["claude:two", true],
      ],
    );
    // The same session coming back (a restart) reopens its entry rather than adding one.
    await runs.detach(run.id, "claude:two");
    await runs.attach(run.id, "claude:two");
    assert.strictEqual(runs.get(run.id)!.sessions.length, 2);
    assert.strictEqual(stateOf(runs.get(run.id)!), "running");
  });

  it("detach_keeps_the_run", async () => {
    const { runs } = book();
    const { run } = await runs.create({
      ...place,
      task: "krk-1",
      agent: "claude",
      runtime: "terminal",
    });
    await runs.attach(run.id, "claude:one");
    await runs.detach(run.id, "claude:one");
    const detached = runs.get(run.id)!;
    assert.strictEqual(stateOf(detached), "detached");
    assert.strictEqual(detached.sessions.length, 1);
    assert.deepStrictEqual(
      runs.ofTask("acme", "pay", "krk-1").map((r) => r.id),
      [run.id],
    );
    // A crash leaves a live session in the record: the next broker detaches it.
    await runs.attach(run.id, "claude:two");
    await runs.recover(new Set());
    assert.strictEqual(stateOf(runs.get(run.id)!), "detached");
    const ended = await runs.end(run.id, "done");
    assert.strictEqual(stateOf(ended!), "ended");
    assert.strictEqual(ended!.outcome, "done");
  });

  it("thread_keys_follow_live_runs", async () => {
    const { runs, saved } = book();
    const tasks = () =>
      Object.fromEntries(
        workRunsOf(Object.values(saved.at(-1)!), "acme", "pay").flatMap((run) =>
          run.keys.map((key) => [key, run.task] as const),
        ),
      );
    // A herdr agent put on a task before its session is known holds its terminal's key.
    await runs.assign("herdr:term", { ...place, task: "krk-1" });
    await runs.assign("peer:thread-1", { ...place, task: "krk-2" });
    assert.deepStrictEqual(tasks(), { "herdr:term": "krk-1", "peer:thread-1": "krk-2" });
    // herdr names the agent's session: the run holds its key and pane, its task stays.
    await runs.rename([{ from: "herdr:term", to: "herdr:claude:s1", pane: "p-2" }]);
    const herdr = runs.holderOf("herdr:claude:s1")!;
    assert.deepStrictEqual([herdr.task, herdr.pane], ["krk-1", "p-2"]);
    await runs.attach(herdr.id, "claude:s1");
    assert.deepStrictEqual(Object.keys(tasks()).toSorted(), [
      "claude:s1",
      "herdr:claude:s1",
      "peer:thread-1",
    ]);
    // Moving a key moves its run; taking it off a task ends the run it named.
    await runs.assign("peer:thread-1", { ...place, task: "krk-3" });
    assert.strictEqual(tasks()["peer:thread-1"], "krk-3");
    await runs.assign("peer:thread-1", null);
    await runs.closeTask("acme", "pay", "krk-1");
    assert.deepStrictEqual(tasks(), {});
    assert.deepStrictEqual(
      runs
        .all()
        .map((run) => run.outcome)
        .toSorted(),
      ["stopped", "task-closed"],
    );
  });
});

describe("PeerRuns and the Hub", () => {
  it.effect("an_old_hub_keeps_runs_local", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({
        current: (url) =>
          url.startsWith("/v1/workspaces/acme/runs/")
            ? [404, { error: { code: "not_found", message: "no such route" } }]
            : [200, {}],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "person" }),
      );
      const runs = yield* PeerRuns.PeerRuns.pipe(Effect.provide(core));
      const state = yield* PeerState.PeerState.pipe(Effect.provide(core));
      // The seed's run from before runs reached the Hub stays here.
      assert.strictEqual(runs.book.holderOf("peer:thread-1")?.local, true);
      const { run } = yield* runs.create({
        ...place,
        task: "krk-1",
        agent: "claude",
        runtime: "terminal",
      });
      yield* runs.sync;
      yield* runs.sync;
      const puts = hub.calls.filter((call) => call.method === "PUT");
      assert.strictEqual(puts.length, 1);
      assert.strictEqual(puts[0]!.url, `/v1/workspaces/acme/runs/pay/${run.id}`);
      const sent = JSON.parse(puts[0]!.body) as Record<string, unknown>;
      assert.strictEqual(sent.state, undefined);
      assert.strictEqual(sent.tokenHash, undefined);
      assert.strictEqual(sent.email, "ana@acme.test");
      const kept = (yield* state.read).persisted;
      assert.isTrue(kept.runs?.[run.id]?.pending);
      const listed = yield* runs.list({ workspace: "acme", projectId: "pay", taskId: "krk-1" });
      assert.include(
        listed.map((r) => r.id),
        run.id,
      );
      // Within the hour nothing asks the Hub again.
      assert.isFalse(
        hub.calls.some((call) => call.method === "GET" && call.url?.includes("/runs/")),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("a run another computer of the person took over lists as the Hub says", () =>
    Effect.gen(function* () {
      const listed: { runs: ReadonlyArray<unknown> } = { runs: [] };
      const hub = yield* standInHub({
        current: (url, method) =>
          method === "GET" && url.startsWith("/v1/workspaces/acme/runs/pay")
            ? [200, listed]
            : [200, {}],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "person" }),
      );
      const runs = yield* PeerRuns.PeerRuns.pipe(Effect.provide(core));
      const { run } = yield* runs.create({
        ...place,
        task: "krk-1",
        agent: "codex",
        runtime: "herdr",
      });
      const view = { ...PeerRuns.toPeerRun(run), state: "detached" as const };
      // The Hub's copy, not yet handed over, says nothing new: this computer's stays.
      listed.runs = [view];
      const before = yield* runs.list({ workspace: "acme", projectId: "pay", taskId: "krk-1" });
      assert.strictEqual(before.find((r) => r.id === run.id)?.environment, "ana-laptop");
      listed.runs = [
        {
          ...view,
          environment: "ana-desk",
          environments: [
            { id: "ana-laptop", from: run.startedAt },
            { id: "ana-desk", from: "2026-10-30T12:00:00.000Z" },
          ],
        },
      ];
      const after = yield* runs.list({ workspace: "acme", projectId: "pay", taskId: "krk-1" });
      assert.deepStrictEqual(
        after.filter((r) => r.id === run.id).map((r) => r.environment),
        ["ana-desk"],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("a run the Hub says moved to another computer of the person leaves this one", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({
        current: (url, method) =>
          method === "PUT" && url.includes("/runs/")
            ? [403, { error: { code: "not_your_run", message: "Not your run." } }]
            : [200, {}],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "person" }),
      );
      const runs = yield* PeerRuns.PeerRuns.pipe(Effect.provide(core));
      const { run } = yield* runs.create({
        ...place,
        task: "krk-1",
        agent: "claude",
        runtime: "herdr",
      });
      yield* runs.sync;
      assert.isUndefined(runs.book.get(run.id));
      // Nothing of it is sent again.
      yield* runs.sync;
      assert.strictEqual(hub.calls.filter((call) => call.method === "PUT").length, 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("a Hub with runs takes each change once", () =>
    Effect.gen(function* () {
      // The Hub answers a write with the run as it keeps it; its own view, not checked here.
      const view = {
        id: "run_00000000000000000000",
        workspace: "acme",
        project: "pay",
        task: "krk-1",
        email: "ana@acme.test",
        environment: "ana-laptop",
        agent: "claude",
        runtime: "terminal",
        startedAt: "2026-10-30T10:00:00.000Z",
        state: "running",
        sessions: [],
        sessionsBefore: 0,
      };
      const hub = yield* standInHub({
        current: (url, method) =>
          url.includes("/runs/") && method === "PUT"
            ? [200, { run: view, changed: true }]
            : [200, {}],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "person" }),
      );
      const runs = yield* PeerRuns.PeerRuns.pipe(Effect.provide(core));
      const { run } = yield* runs.create({
        ...place,
        task: "krk-1",
        agent: "claude",
        runtime: "terminal",
      });
      yield* runs.sync;
      yield* runs.sync;
      assert.strictEqual(hub.calls.filter((call) => call.method === "PUT").length, 1);
      assert.isFalse(runs.book.get(run.id)?.pending);
      yield* Effect.promise(() => runs.book.end(run.id, "stopped"));
      yield* runs.sync;
      const last = hub.calls.findLast((call) => call.method === "PUT")!;
      assert.strictEqual((JSON.parse(last.body) as { outcome?: string }).outcome, "stopped");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
