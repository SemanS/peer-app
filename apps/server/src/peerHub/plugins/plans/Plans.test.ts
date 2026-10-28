// @effect-diagnostics preferSchemaOverJson:off - test-only Hub request bodies.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PeerHubError, type PeerPlanDeclaration } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { CliError, render } from "../../core/plugin.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerWork } from "../../core/work/PeerWork.ts";
import {
  coreLayer,
  meAnswer,
  paymentsSeed,
  seedState,
  standInHub,
  type HubCall,
} from "../../core/testkit.ts";
import type { CodeGraph } from "./client/codegraph.ts";
import { plansHub } from "./client/hub.ts";
import { challenge, plan, relation, sessionView, side, AT } from "./fixtures.test.ts";
import { LACKS_CHALLENGES } from "./client/hub.ts";
import type { Items } from "./client/hub.ts";
import { makePlans } from "./Plans.ts";

/** When the stand-in Hub says it answered. */
const WHEN = "2026-10-12T20:00:00Z";
const ME = { email: "ana@acme.test", environment: "ana-laptop" };
const mine = (task = "krk-1") => side("claude:a", task, ME.email, ME.environment);
const theirs = (session = "codex:b", task: string | undefined = "krk-2") =>
  side(session, task, "bob@acme.test", "bob-mac");
const ownPlan = (over: Parameters<typeof plan>[0] = {}) =>
  plan({ session: "claude:a", task: "krk-1", ...ME, ...over });
const rel = (id: string, over: Parameters<typeof relation>[1] = {}) =>
  relation(id, { a: mine(), b: theirs(), ...over });
const view = (relations = [rel("r1")], plans = [ownPlan()]) => ({
  plans,
  relations,
  omitted: 0,
  at: WHEN,
});
const declared = (changed: boolean, relations = [rel("r1")]) => ({
  plan: ownPlan(),
  relations,
  omitted: 0,
  changed,
  at: WHEN,
});
const down = [503, { error: { code: "unavailable", message: "The hub is down." } }] as const;
const items = (over: Partial<Items> = {}): Items => ({
  changes: [{ path: "src/tax.ts", name: "applyTax" }],
  maybes: [],
  uses: [],
  provides: [],
  ...over,
});
/** An index that must not be asked: these tests name no symbol. */
const noGraph: CodeGraph = {
  ready: async () => assert.fail("the index was asked"),
  symbols: async () => assert.fail("the index was asked"),
};

const world = (
  answer: (call: HubCall) => readonly [number, unknown],
  options: { adapter?: "hooks" | "mcp" } = {},
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(AT);
    let seen: ReadonlyArray<HubCall> = [];
    const hub = yield* standInHub({ current: () => answer(seen.at(-1)!) });
    seen = hub.calls;
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "s", plugins: [] }),
    );
    const { state, client, work } = yield* Effect.all({
      state: PeerState,
      client: PeerHubClient,
      work: PeerWork,
    }).pipe(Effect.provide(core));
    const sessions = [
      sessionView({ id: "claude:a", task: "krk-1", adapter: options.adapter ?? "hooks" }),
    ];
    const synced: Array<readonly [string, number]> = [];
    const logged: Array<{ event: string; fields: Readonly<Record<string, unknown>> }> = [];
    const agents = yield* PeerAgents.pipe(
      Effect.provide(
        Layer.mock(PeerAgents)({
          sessions: Effect.succeed(sessions),
          sync: (workspace, ms) => Effect.sync(() => void synced.push([workspace, ms])),
          log: (event, fields) => Effect.sync(() => void logged.push({ event, fields })),
          inPane: () => undefined,
          level: () => "B",
        }),
      ),
    );
    const service = yield* makePlans(state, agents, work, plansHub(client), noGraph);
    const sent = (method: string) =>
      hub.calls
        .filter((call) => call.method === method)
        .map((call) => ({ url: call.url, body: JSON.parse(call.body) as PeerPlanDeclaration }));
    return { service, hub, client, sessions, synced, logged, sent, session: sessions[0]! };
  }).pipe(Effect.provide(NodeServices.layer));

const declare = (
  w: Effect.Success<ReturnType<typeof world>>,
  input: { mode?: "replace" | "amend"; items?: Items } = {},
) =>
  w.service.commands.declare(w.session, {
    mode: input.mode ?? "replace",
    items: input.items ?? items(),
  });

/** A declaration the Hub does not answer: it waits, and the command ends uncertain. */
const waits = (
  w: Effect.Success<ReturnType<typeof world>>,
  input: Parameters<typeof declare>[1] = {},
) => declare(w, input).pipe(Effect.result);

describe("declaring a plan", () => {
  it.effect("records it at the Hub with its time, and tells what meets it once", () =>
    Effect.gen(function* () {
      let changed = true;
      const w = yield* world((call) =>
        call.method === "PUT" ? [200, declared(changed)] : [200, view()],
      );
      const first = yield* declare(w);
      assert.deepStrictEqual(w.synced, [["acme", 2_000]]);
      const [put] = w.sent("PUT");
      assert.strictEqual(put?.url, "/v1/workspaces/acme/plans/pay");
      assert.deepStrictEqual(put?.body, {
        environment: "ana-laptop",
        session: "claude:a",
        seq: AT,
        mode: "replace",
        changes: [{ path: "src/tax.ts", name: "applyTax" }],
        maybes: [],
        uses: [],
        provides: [],
      });
      assert.deepStrictEqual(
        first.relations.map((r) => r.id),
        ["r1"],
      );
      assert.strictEqual(first.total, 1);
      // Said once: the same relation is not listed again for a plan that changed...
      const again = yield* declare(w);
      assert.isTrue(again.relations.length === 0 && again.total === 1);
      // ...but is listed again when nothing changed, as the answer to the same plan again.
      changed = false;
      const same = yield* declare(w);
      assert.lengthOf(same.relations, 1);
      // Two declarations in one millisecond still go in order.
      assert.deepStrictEqual(
        w.sent("PUT").map((call) => call.body.seq),
        [AT, AT + 1, AT + 2],
      );
    }).pipe(Effect.scoped),
  );

  it.effect("lists every relation again to a thread that hears none at its steps", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [200, declared(true)], { adapter: "mcp" });
      const first = yield* declare(w);
      const second = yield* declare(w);
      assert.lengthOf(first.relations, 1);
      assert.lengthOf(second.relations, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("fails a declaration the Hub finds wrong, and keeps nothing to send again", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [
        400,
        { error: { code: "invalid_request", message: "changes `../x` is not valid" } },
      ]);
      const failed = yield* declare(w).pipe(Effect.result);
      assert.isTrue(Result.isFailure(failed));
      if (Result.isFailure(failed)) {
        assert.instanceOf(failed.failure, PeerHubError);
        assert.strictEqual((failed.failure as PeerHubError).status, 400);
      }
      yield* TestClock.adjust("5 minutes");
      yield* w.service.tick;
      assert.lengthOf(w.sent("PUT"), 1);
    }).pipe(Effect.scoped),
  );

  it.effect("learns that the Hub has no plans, and stops asking for ten minutes", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [
        404,
        { error: { code: "not_found", message: "no such route" } },
      ]);
      const answer = yield* declare(w).pipe(Effect.result);
      assert.strictEqual(
        Result.isFailure(answer) ? render(answer.failure as CliError) : "",
        "peer: refused: plans need a newer Peer Hub; nothing was recorded.\nNext: ask a workspace admin to update the Hub",
      );
      assert.strictEqual((yield* w.service.status).hubSupport, "unsupported");
      yield* w.service.readSoon("acme");
      yield* w.service.tick;
      assert.lengthOf(
        w.hub.calls.filter((call) => call.method === "GET"),
        0,
      );
      yield* TestClock.adjust("11 minutes");
      yield* w.service.readSoon("acme");
      yield* w.service.tick;
      assert.lengthOf(
        w.hub.calls.filter((call) => call.method === "GET"),
        1,
      );
    }).pipe(Effect.scoped),
  );
});

describe("a Hub that does not answer", () => {
  it.effect("keeps the declaration and sends the same one again when the Hub answers", () =>
    Effect.gen(function* () {
      let outage = true;
      const w = yield* world((call) =>
        outage ? down : call.method === "PUT" ? [200, declared(true)] : [200, view()],
      );
      const silent = yield* declare(w).pipe(Effect.result);
      assert.strictEqual(
        Result.isFailure(silent) ? render(silent.failure as CliError) : "",
        "peer: uncertain: the Hub did not answer; Peer sends this plan again when it answers and records it once.\nNext: peer plan",
      );
      yield* TestClock.adjust("9 seconds");
      yield* w.service.tick;
      assert.lengthOf(w.sent("PUT"), 1);
      outage = false;
      yield* TestClock.adjust("2 seconds");
      yield* w.service.tick;
      const [first, second] = w.sent("PUT");
      assert.lengthOf(w.sent("PUT"), 2);
      // The same declaration, with the seq it was made with: recorded at most once.
      assert.deepStrictEqual(second?.body, first?.body);
      // Nothing waits any more.
      yield* TestClock.adjust("2 minutes");
      yield* w.service.tick;
      assert.lengthOf(w.sent("PUT"), 2);
      // The view of the workspace is read after it.
      assert.isAbove(w.hub.calls.filter((call) => call.method === "GET").length, 0);
    }).pipe(Effect.scoped),
  );

  it.effect("tries again every ten seconds at first and every minute after six tries", () =>
    Effect.gen(function* () {
      const w = yield* world(() => down);
      yield* waits(w);
      let sends = 1;
      for (let step = 1; step <= 6; step += 1) {
        yield* TestClock.adjust("9 seconds");
        yield* w.service.tick;
        assert.lengthOf(w.sent("PUT"), sends);
        yield* TestClock.adjust("1 second");
        yield* w.service.tick;
        sends += 1;
        assert.lengthOf(w.sent("PUT"), sends);
      }
      yield* TestClock.adjust("50 seconds");
      yield* w.service.tick;
      assert.lengthOf(w.sent("PUT"), sends);
      yield* TestClock.adjust("10 seconds");
      yield* w.service.tick;
      assert.lengthOf(w.sent("PUT"), sends + 1);
    }).pipe(Effect.scoped),
  );

  it.effect("sends only the newer declaration, and adds an amendment to the one that waits", () =>
    Effect.gen(function* () {
      let outage = true;
      const w = yield* world((call) =>
        outage ? down : call.method === "PUT" ? [200, declared(true)] : [200, view()],
      );
      yield* waits(w, { items: items({ changes: [{ path: "src/a.ts" }] }) });
      yield* TestClock.adjust("1 second");
      yield* waits(w, { items: items({ changes: [{ path: "src/b.ts" }] }) });
      yield* TestClock.adjust("1 second");
      yield* waits(w, {
        mode: "amend",
        items: items({ changes: [], uses: [{ path: "src/c.ts", name: "c" }] }),
      });
      outage = false;
      yield* TestClock.adjust("20 seconds");
      yield* w.service.tick;
      const sent = w.sent("PUT");
      const last = sent.at(-1)!;
      assert.lengthOf(sent, 4);
      assert.strictEqual(last.body.mode, "replace");
      assert.deepStrictEqual(last.body.changes, [{ path: "src/b.ts" }]);
      assert.deepStrictEqual(last.body.uses, [{ path: "src/c.ts", name: "c" }]);
      // Its seq is the newest declaration's, so a late older one can never replace it.
      assert.strictEqual(last.body.seq, Math.max(...sent.map((call) => call.body.seq)));
      yield* TestClock.adjust("2 minutes");
      yield* w.service.tick;
      assert.lengthOf(w.sent("PUT"), 4);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "drops a declaration the Hub refuses as older than its plan, and never sends it again",
    () =>
      Effect.gen(function* () {
        let mode: "down" | "stale" | "ok" = "down";
        const w = yield* world(() =>
          mode === "down"
            ? down
            : mode === "stale"
              ? [
                  409,
                  { error: { code: "stale_seq", message: "stale", details: { seq: AT + 5_000 } } },
                ]
              : [200, view()],
        );
        yield* waits(w);
        mode = "stale";
        yield* TestClock.adjust("10 seconds");
        yield* w.service.tick;
        assert.lengthOf(w.sent("PUT"), 2);
        mode = "ok";
        yield* TestClock.adjust("5 minutes");
        yield* w.service.tick;
        assert.lengthOf(w.sent("PUT"), 2);
      }).pipe(Effect.scoped),
  );

  it.effect("refuses a declaration made against a newer plan instead of recording it", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [
        409,
        { error: { code: "stale_seq", message: "stale", details: { seq: AT + 5_000 } } },
      ]);
      const stale = yield* declare(w).pipe(Effect.result);
      assert.isTrue(Result.isFailure(stale));
      assert.strictEqual(
        (Result.isFailure(stale) ? stale.failure : undefined)?.constructor,
        CliError,
      );
    }).pipe(Effect.scoped),
  );

  it.effect("forgets a declaration when its session is gone", () =>
    Effect.gen(function* () {
      let outage = true;
      const w = yield* world((call) =>
        outage ? down : call.method === "PUT" ? [200, declared(true)] : [200, view()],
      );
      yield* waits(w);
      w.sessions.length = 0;
      outage = false;
      yield* TestClock.adjust("1 minute");
      yield* w.service.tick;
      assert.lengthOf(w.sent("PUT"), 1);
    }).pipe(Effect.scoped),
  );
});

describe("withdrawing", () => {
  it.effect("ends the Hub's plan and the declaration that waits, and says how many ended", () =>
    Effect.gen(function* () {
      let outage = true;
      const w = yield* world((call) =>
        call.url?.endsWith("/withdraw")
          ? outage
            ? down
            : [200, { withdrawn: 1, at: WHEN }]
          : outage
            ? down
            : [200, declared(true)],
      );
      yield* waits(w);
      outage = false;
      const ended = yield* w.service.commands.withdraw(w.session);
      assert.strictEqual(ended.ended, 2);
      const post = w.hub.calls.find((call) => call.method === "POST");
      assert.strictEqual(post?.url, "/v1/workspaces/acme/plans/withdraw");
      assert.deepStrictEqual(JSON.parse(post?.body ?? "{}"), {
        environment: "ana-laptop",
        session: "claude:a",
      });
      // The declaration that waited is gone: it is not sent again.
      yield* TestClock.adjust("1 minute");
      yield* w.service.tick;
      assert.lengthOf(w.sent("PUT"), 1);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "ends nothing for a session without a plan, and fails when the Hub does not answer",
    () =>
      Effect.gen(function* () {
        let outage = false;
        const w = yield* world(() => (outage ? down : [200, { withdrawn: 0, at: WHEN }]));
        assert.strictEqual((yield* w.service.commands.withdraw(w.session)).ended, 0);
        outage = true;
        assert.isTrue(
          Result.isFailure(yield* w.service.commands.withdraw(w.session).pipe(Effect.result)),
        );
      }).pipe(Effect.scoped),
  );

  it.effect("withdraws every plan of this computer when its owner turns plans off", () =>
    Effect.gen(function* () {
      let outage = true;
      const w = yield* world((call) =>
        call.url?.endsWith("/withdraw")
          ? outage
            ? down
            : [200, { withdrawn: 3, at: WHEN }]
          : down,
      );
      yield* waits(w);
      // The Hub is down: the plans stay until their sessions end, and the failure is reported.
      const failed = yield* w.service.turnOff.pipe(Effect.result);
      assert.isTrue(Result.isFailure(failed));
      assert.include(Result.isFailure(failed) ? failed.failure.detail : "", "acme");
      outage = false;
      yield* w.service.turnOff;
      const posts = w.hub.calls.filter((call) => call.method === "POST");
      assert.lengthOf(posts, 2);
      // For the computer: no session in the request.
      assert.deepStrictEqual(JSON.parse(posts.at(-1)?.body ?? "{}"), { environment: "ana-laptop" });
      // Nothing waits to bring a plan back.
      yield* TestClock.adjust("5 minutes");
      yield* w.service.tick;
      assert.lengthOf(w.sent("PUT"), 1);
      assert.deepStrictEqual((yield* w.service.status).counts, []);
    }).pipe(Effect.scoped),
  );

  it.effect("forgets a workspace's declarations and view when it is left", () =>
    Effect.gen(function* () {
      const w = yield* world((call) => (call.method === "GET" ? [200, view()] : down));
      yield* waits(w);
      yield* w.service.readSoon("acme");
      yield* w.service.tick;
      assert.isAbove((yield* w.service.status).counts.length, 0);
      yield* w.service.forget("acme");
      assert.deepStrictEqual((yield* w.service.status).counts, []);
      yield* TestClock.adjust("5 minutes");
      yield* w.service.tick;
      assert.lengthOf(w.sent("PUT"), 1);
    }).pipe(Effect.scoped),
  );
});

describe("the Hub's view", () => {
  it.effect("is read after a ping, counted per task, and published only when it differs", () =>
    Effect.gen(function* () {
      let shown = view([rel("r1"), rel("r2", { b: theirs("codex:c", "krk-3") })]);
      const w = yield* world(() => [200, shown]);
      const before = yield* w.service.status;
      assert.strictEqual(before.hubSupport, "unknown");
      yield* w.service.readSoon("acme");
      yield* w.service.tick;
      const after = yield* w.service.status;
      assert.strictEqual(after.hubSupport, "supported");
      assert.isDefined(after.lastContact);
      assert.deepStrictEqual(
        [...after.counts].sort((a, b) => a.task.localeCompare(b.task)),
        [
          { workspace: "acme", project: "pay", task: "krk-1", plans: 1, relations: 2 },
          { workspace: "acme", project: "pay", task: "krk-2", plans: 0, relations: 1 },
          { workspace: "acme", project: "pay", task: "krk-3", plans: 0, relations: 1 },
        ],
      );
      assert.isAbove(after.revision, before.revision);
      // The same view again moves nothing.
      yield* w.service.readSoon("acme");
      yield* w.service.tick;
      assert.strictEqual((yield* w.service.status).revision, after.revision);
      // A plan that is not live counts for no task; a changed view moves the revision.
      shown = view([rel("r1")], [ownPlan({ live: false })]);
      yield* w.service.readSoon("acme");
      yield* w.service.tick;
      const last = yield* w.service.status;
      assert.isAbove(last.revision, after.revision);
      assert.deepStrictEqual(
        last.counts.find((row) => row.task === "krk-1"),
        { workspace: "acme", project: "pay", task: "krk-1", plans: 0, relations: 1 },
      );
    }).pipe(Effect.scoped),
  );

  it.effect("counts each open challenge once for every task it meets or whose agent made it", () =>
    Effect.gen(function* () {
      const open = challenge("ch-1", {
        by: theirs(),
        meets: [
          { side: mine(), role: "uses" },
          { side: theirs("codex:c", "krk-2"), role: "changes" },
        ],
      });
      const closed = challenge("ch-2", { by: theirs("codex:d", "krk-4"), state: "closed" });
      let shown: object = {
        ...view([rel("r1", { b: theirs("codex:c", "krk-3") })]),
        challenges: [open, closed],
      };
      const w = yield* world(() => [200, shown]);
      yield* reread(w);
      const status = yield* w.service.status;
      assert.deepStrictEqual(
        [...status.counts].sort((a, b) => a.task.localeCompare(b.task)),
        [
          {
            workspace: "acme",
            project: "pay",
            task: "krk-1",
            plans: 1,
            relations: 1,
            challenges: 1,
          },
          {
            workspace: "acme",
            project: "pay",
            task: "krk-2",
            plans: 0,
            relations: 0,
            challenges: 1,
          },
          {
            workspace: "acme",
            project: "pay",
            task: "krk-3",
            plans: 0,
            relations: 1,
            challenges: 0,
          },
        ],
      );
      // A changed challenge alone moves the revision; a task's place lists the challenges it meets.
      shown = { ...view([rel("r1", { b: theirs("codex:c", "krk-3") })]), challenges: [open] };
      yield* reread(w);
      assert.isAbove((yield* w.service.status).revision, status.revision);
      const krk3 = yield* w.service.list({ workspace: "acme", task: "krk-3" });
      assert.deepStrictEqual(krk3.challenges, []);
      const krk2 = yield* w.service.list({ workspace: "acme", task: "krk-2" });
      assert.deepStrictEqual(
        krk2.challenges?.map((one) => one.id),
        ["ch-1"],
      );
      // A Hub older than plans revision 2 sends no challenges, and no row carries the field.
      shown = view([rel("r1")]);
      yield* reread(w);
      assert.isTrue((yield* w.service.status).counts.every((row) => !("challenges" in row)));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "is read once however many pings came, and not at all for a workspace it does not know",
    () =>
      Effect.gen(function* () {
        const w = yield* world(() => [200, view()]);
        for (let ping = 0; ping < 5; ping += 1) yield* w.service.readSoon("acme");
        yield* w.service.tick;
        yield* w.service.tick;
        assert.lengthOf(
          w.hub.calls.filter((call) => call.method === "GET"),
          1,
        );
      }).pipe(Effect.scoped),
  );

  it.effect("is read by the background work each second, publishing when the status moved", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [200, view()]);
      const published = yield* Deferred.make<void>();
      const fiber = yield* w.service
        .run(Deferred.succeed(published, undefined))
        .pipe(Effect.forkChild);
      yield* TestClock.adjust("1 second");
      yield* Deferred.await(published);
      assert.isAbove((yield* w.service.status).counts.length, 0);
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.scoped),
  );

  it.effect("is listed for a place: a project, a task, and nothing of an unknown workspace", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [
        200,
        view(
          [rel("r1"), rel("r2", { a: theirs("codex:c", "krk-3"), b: theirs("codex:d", "krk-4") })],
          [ownPlan(), ownPlan({ session: "codex:c", task: "krk-3" })],
        ),
      ]);
      const all = yield* w.service.list({ workspace: "acme" });
      assert.lengthOf(all.plans, 2);
      assert.lengthOf(all.relations, 2);
      const task = yield* w.service.list({ workspace: "acme", task: "krk-1" });
      assert.deepStrictEqual(
        [task.plans.map((p) => p.task), task.relations.map((r) => r.id)],
        [["krk-1"], ["r1"]],
      );
      assert.lengthOf((yield* w.service.list({ workspace: "acme", project: "web" })).plans, 0);
      const refused = yield* w.service.list({ workspace: "elsewhere" }).pipe(Effect.result);
      assert.isTrue(Result.isFailure(refused));
    }).pipe(Effect.scoped),
  );

  it.effect("says what is not on the Hub when it has no plans", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [
        404,
        { error: { code: "not_found", message: "no such route" } },
      ]);
      const list = yield* w.service.list({ workspace: "acme" }).pipe(Effect.result);
      assert.isTrue(Result.isFailure(list));
      assert.include(Result.isFailure(list) ? list.failure.detail : "", "newer Peer Hub");
    }).pipe(Effect.scoped),
  );
});

describe("showing a plan", () => {
  it.effect("shows the session's own plan and the relations it was not told of", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [
        200,
        view(
          [rel("r1"), rel("r2", { a: theirs(), b: theirs("codex:c", "krk-3") })],
          [
            ownPlan(),
            ownPlan({ session: "codex:b", email: "bob@acme.test", environment: "bob-mac" }),
          ],
        ),
      ]);
      const first = yield* w.service.commands.show(w.session);
      assert.strictEqual(first.plan?.session, "claude:a");
      assert.deepStrictEqual(
        first.relations.map((r) => r.id),
        ["r1"],
      );
      assert.strictEqual(first.total, 1);
      const second = yield* w.service.commands.show(w.session);
      assert.deepStrictEqual(second.relations, []);
      assert.strictEqual(second.total, 1);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "shows a session without a plan as having none, and lists a project's plans to a shell",
    () =>
      Effect.gen(function* () {
        const w = yield* world(() => [
          200,
          view(
            [],
            [
              ownPlan({ session: "codex:z", environment: "bob-mac", email: "bob@acme.test" }),
              ownPlan({ live: false, session: "codex:y" }),
            ],
          ),
        ]);
        const shown = yield* w.service.commands.show(w.session);
        assert.isUndefined(shown.plan);
        const open = yield* w.service.commands.publicView(sessionView({ public: true, id: "" }));
        assert.deepStrictEqual(
          open.plans.map((p) => p.session),
          ["codex:z"],
        );
        assert.strictEqual(open.project, "pay");
      }).pipe(Effect.scoped),
  );

  it.effect("lists every relation again to a thread that hears none at its steps", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [200, view()], { adapter: "mcp" });
      assert.lengthOf((yield* w.service.commands.show(w.session)).relations, 1);
      assert.lengthOf((yield* w.service.commands.show(w.session)).relations, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses to read a Hub that does not answer", () =>
    Effect.gen(function* () {
      const w = yield* world(() => down);
      const failed = yield* w.service.commands.show(w.session).pipe(Effect.result);
      assert.isTrue(Result.isFailure(failed));
    }).pipe(Effect.scoped),
  );
});

const step = (w: Effect.Success<ReturnType<typeof world>>, over: Record<string, unknown> = {}) =>
  w.service.notice({
    session: w.session,
    event: "prompt",
    remainingMs: 1_000,
    ...over,
  } as Parameters<typeof w.service.notice>[0]);
/** The view of the workspace is read, as it is after a ping. */
const reread = (w: Effect.Success<ReturnType<typeof world>>) =>
  Effect.gen(function* () {
    yield* w.service.readSoon("acme");
    yield* w.service.tick;
  });

describe("what a session hears at its steps", () => {
  it.effect("hears a relation once, again when its contract changes, and not when it is gone", () =>
    Effect.gen(function* () {
      let shown = view([rel("r1", { contract: "takes cents" })]);
      const w = yield* world(() => [200, shown]);
      yield* reread(w);
      const first = yield* step(w);
      assert.include(first ?? "", "plans to change applyTax (src/tax.ts)");
      assert.isNull(yield* step(w));
      assert.isNull(yield* step(w));
      shown = view([rel("r1", { contract: "takes cents, returns a string" })]);
      yield* reread(w);
      assert.include((yield* step(w)) ?? "", "takes cents, returns a string");
      assert.isNull(yield* step(w));
      // Withdrawn before the next step: the view no longer has it, so nothing is said.
      shown = view([rel("r2")]);
      yield* reread(w);
      shown = view([]);
      yield* reread(w);
      assert.isNull(yield* step(w));
      const told = w.logged.filter((line) => line.event === "plans.told");
      assert.lengthOf(told, 2);
      assert.deepStrictEqual(Object.keys(told[0]?.fields ?? {}).sort(), [
        "challenges",
        "chars",
        "relations",
        "session",
      ]);
      assert.notInclude(JSON.stringify(w.logged), "applyTax");
    }).pipe(Effect.scoped),
  );

  it.effect("tells what it was not told, three at a step, the rest at the next", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [
        200,
        view(
          Array.from({ length: 5 }, (_, at) => rel(`r${at}`, { item: { path: `src/f${at}.ts` } })),
        ),
      ]);
      yield* reread(w);
      const first = (yield* step(w)) ?? "";
      assert.include(first, "Further plan relations: peer plan (2 more)");
      const second = (yield* step(w)) ?? "";
      assert.include(second, "src/f3.ts");
      assert.notInclude(second, "Further");
      assert.isNull(yield* step(w));
    }).pipe(Effect.scoped),
  );

  it.effect("tells a Claude Code or Codex agent and nobody else, and never a woken one", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [200, view()]);
      yield* reread(w);
      assert.isNull(yield* step(w, { waking: true }));
      assert.isNull(yield* step(w, { session: sessionView({ id: "claude:a", agent: "cursor" }) }));
      assert.isNull(yield* step(w, { session: sessionView({ id: "claude:a", adapter: "mcp" }) }));
      assert.isNotNull(yield* step(w, { session: { ...w.session, agent: "codex" } }));
      const mcp = yield* world(() => [200, view()], { adapter: "mcp" });
      yield* reread(mcp);
      assert.isNull(yield* step(mcp));
    }).pipe(Effect.scoped),
  );

  it.effect("hears its open relations once more after its context is compacted", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [200, view()]);
      yield* reread(w);
      assert.isNotNull(yield* step(w));
      assert.isNull(yield* step(w));
      // A new conversation is core's to reset; a compaction is the plugin's.
      yield* w.service.started({
        session: w.session,
        event: "session-start",
        source: "startup",
        remainingMs: 1_000,
      });
      assert.isNull(yield* step(w));
      yield* w.service.started({
        session: w.session,
        event: "session-start",
        source: "compact",
        remainingMs: 1_000,
      });
      assert.isNotNull(yield* step(w));
      assert.isNull(yield* step(w));
      assert.deepStrictEqual(
        w.logged.filter((line) => line.event === "plans.nudged").map((line) => line.fields.where),
        ["start", "start"],
      );
    }).pipe(Effect.scoped),
  );

  it.effect(
    "reminds an agent that leaves plan mode without a plan, once, and only with the Mod",
    () =>
      Effect.gen(function* () {
        const w = yield* world(() => [200, view([], [])]);
        const left = (
          session = sessionView({ id: "claude:a", adapter: "mod" }),
          tool = "ExitPlanMode",
        ) =>
          w.service.planMode({ session, event: "post-tool", tool, paths: [], remainingMs: 1_000 });
        assert.isNull(yield* left(sessionView({ id: "claude:a", adapter: "hooks" })));
        assert.isNull(yield* left(undefined, "Bash"));
        const mod = sessionView({ id: "claude:a", adapter: "mod" });
        // An ExitPlanMode that failed left the agent in plan mode: the line waits for its exit.
        assert.isNull(
          yield* w.service.planMode({
            session: mod,
            event: "post-tool",
            tool: "ExitPlanMode",
            paths: [],
            failed: true,
            remainingMs: 1_000,
          }),
        );
        assert.include((yield* left(mod)) ?? "", "You left plan mode without a plan");
        assert.isNull(yield* left(mod));
        // A new runtime generation has fresh memory: it hears the line once more.
        assert.isNotNull(yield* left(sessionView({ id: "claude:a", adapter: "mod" })));
        assert.deepStrictEqual(
          w.logged.filter((line) => line.event === "plans.nudged").map((line) => line.fields.where),
          ["plan-mode", "plan-mode"],
        );
      }).pipe(Effect.scoped),
  );

  it.effect(
    "says nothing on leaving plan mode when it has a plan, declared here or read from the Hub",
    () =>
      Effect.gen(function* () {
        const w = yield* world((call) =>
          call.method === "PUT" ? [200, declared(true)] : [200, view()],
        );
        const left = (session: ReturnType<typeof sessionView>) =>
          w.service.planMode({
            session,
            event: "post-tool",
            tool: "ExitPlanMode",
            paths: [],
            remainingMs: 1_000,
          });
        yield* declare(w);
        assert.isNull(yield* left(w.session));
        // Another run of Peer, which never saw the declaration, finds the plan in the Hub's view.
        const fresh = sessionView({ id: "claude:a", adapter: "mod" });
        yield* reread(w);
        assert.isNull(yield* left(fresh));
      }).pipe(Effect.scoped),
  );

  it.effect("ends a session's plan with the session, and only when it had one", () =>
    Effect.gen(function* () {
      const w = yield* world((call) =>
        call.method === "PUT" ? [200, declared(true)] : [200, { withdrawn: 1, at: WHEN }],
      );
      yield* w.service.ended(w.session);
      assert.lengthOf(w.hub.calls, 0);
      yield* declare(w);
      yield* w.service.ended(w.session);
      const post = w.hub.calls.find((call) => call.method === "POST");
      assert.deepStrictEqual(JSON.parse(post?.body ?? "{}"), {
        environment: "ana-laptop",
        session: "claude:a",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("drops the declaration that waits when its session ends", () =>
    Effect.gen(function* () {
      let outage = true;
      const w = yield* world((call) =>
        outage
          ? down
          : call.method === "PUT"
            ? [200, declared(true)]
            : [200, { withdrawn: 0, at: WHEN }],
      );
      yield* waits(w);
      outage = false;
      yield* w.service.ended(w.session);
      yield* TestClock.adjust("1 minute");
      yield* w.service.tick;
      assert.lengthOf(w.sent("PUT"), 1);
    }).pipe(Effect.scoped),
  );

  it.effect("logs what was sent again, and what was withdrawn, as counts and classes", () =>
    Effect.gen(function* () {
      let mode: "down" | "ok" = "down";
      const w = yield* world((call) =>
        mode === "down"
          ? down
          : call.method === "PUT"
            ? [200, declared(true)]
            : [200, { withdrawn: 2, at: WHEN }],
      );
      yield* waits(w);
      yield* TestClock.adjust("10 seconds");
      yield* w.service.tick;
      mode = "ok";
      yield* TestClock.adjust("10 seconds");
      yield* w.service.tick;
      yield* w.service.commands.withdraw(w.session);
      assert.deepStrictEqual(
        w.logged.map((line) => [line.event, line.fields.outcome ?? line.fields.count]),
        [
          ["plans.resent", "failed"],
          ["plans.resent", "sent"],
          ["plans.withdrawn", 2],
        ],
      );
    }).pipe(Effect.scoped),
  );
});

describe("the line of peer status", () => {
  it.effect("names the plan and its relations from what was read, and nothing before that", () =>
    Effect.gen(function* () {
      let shown = view([rel("r1"), rel("r2")]);
      const w = yield* world(() => [200, shown]);
      assert.isNull(yield* w.service.statusBlock(w.session));
      yield* reread(w);
      assert.strictEqual(
        yield* w.service.statusBlock(w.session),
        "Plan v2: 1 change, 1 maybe, 1 use, 1 contract; 2 relations. peer plan shows them.",
      );
      shown = view([], []);
      yield* reread(w);
      assert.include((yield* w.service.statusBlock(w.session)) ?? "", "Plan: none declared");
    }).pipe(Effect.scoped),
  );

  it.effect("says nothing of a plan that waits for the Hub, which the view does not hold yet", () =>
    Effect.gen(function* () {
      let outage = true;
      const w = yield* world((call) =>
        outage ? down : call.method === "PUT" ? [200, declared(true)] : [200, view([], [])],
      );
      yield* waits(w);
      outage = false;
      yield* reread(w);
      assert.isNull(yield* w.service.statusBlock(w.session));
    }).pipe(Effect.scoped),
  );
});

/** Bob's challenge of `formatPrice`, which this session's plan (Ana's, KRK-1) uses. */
const bobs = (id: string, over: Parameters<typeof challenge>[1] = {}) =>
  challenge(id, { by: theirs(), meets: [{ side: mine(), role: "uses" }], ...over });
const closedBy = (by: ReturnType<typeof side>, note?: string) => ({
  state: "closed" as const,
  updatedAt: "2026-10-12T20:11:00Z",
  closed: { by, at: "2026-10-12T20:11:00Z", ...(note === undefined ? {} : { note }) },
});
const challenged = (over: Parameters<typeof challenge>[1] = {}, changed = true) => ({
  challenge: bobs("ch-1", over),
  hearing: 1,
  changed,
  at: WHEN,
});
/** A world on a Hub that serves plans at `revision`, its catalog read. */
const served = (revision: number, answer: (call: HubCall) => readonly [number, unknown]) =>
  Effect.gen(function* () {
    const w = yield* world((call) =>
      call.url === "/v1/me" ? [200, meAnswer({ plans: revision })] : answer(call),
    );
    yield* w.client.me;
    return w;
  });
const record = {
  _tag: "challenge",
  form: "record",
  item: { path: "src/money.ts", name: "formatPrice" },
  reason: "takes euros as a decimal, not cents",
} as const;

describe("challenging a plan item", () => {
  it.effect(
    "records and closes one with a plain request, and logs counts, never what it says",
    () =>
      Effect.gen(function* () {
        const w = yield* served(2, (call) =>
          call.method === "POST" ? [200, challenged()] : [200, view()],
        );
        const text = yield* w.service.commands.challenge(w.session, record);
        assert.include(text, "Challenge ch-1 recorded: src/money.ts#formatPrice.");
        const closed = yield* w.service.commands.challenge(w.session, {
          _tag: "challenge",
          form: "close",
          id: "ch-1",
          note: "fine after all",
        });
        assert.include(closed, "closed");
        assert.deepStrictEqual(
          w.hub.calls
            .filter((call) => call.method === "POST")
            .map((call) => [call.url, JSON.parse(call.body)]),
          [
            [
              "/v1/workspaces/acme/plans/pay/challenges",
              {
                environment: "ana-laptop",
                session: "claude:a",
                item: record.item,
                reason: record.reason,
              },
            ],
            [
              "/v1/workspaces/acme/plans/pay/challenges",
              {
                environment: "ana-laptop",
                session: "claude:a",
                close: "ch-1",
                note: "fine after all",
              },
            ],
          ],
        );
        assert.deepStrictEqual(
          w.logged.map((line) => [line.event, Object.keys(line.fields).sort()]),
          [
            ["plans.challenge.recorded", ["changed", "chars", "hearing", "session"]],
            ["plans.challenge.closed", ["changed", "chars", "hearing", "session"]],
          ],
        );
        for (const words of ["formatPrice", "money", "euros", "fine after", "krk"])
          assert.notInclude(JSON.stringify(w.logged), words);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "is refused on a Hub whose plans are older than revision 2, which plans keep working on",
    () =>
      Effect.gen(function* () {
        const w = yield* served(1, (call) =>
          call.method === "PUT" ? [200, declared(true)] : [200, view()],
        );
        for (const request of [record, { _tag: "challenge", form: "list" } as const]) {
          const refused = yield* w.service.commands
            .challenge(w.session, request)
            .pipe(Effect.result);
          assert.isTrue(Result.isFailure(refused) && refused.failure === LACKS_CHALLENGES);
        }
        assert.isEmpty(w.hub.calls.filter((call) => call.url?.includes("plans")));
        assert.strictEqual((yield* declare(w)).plan.version, 2);
      }).pipe(Effect.scoped),
  );

  it.effect("leaves an unanswered challenge to the command, which ends it uncertain", () =>
    Effect.gen(function* () {
      const w = yield* served(2, () => down);
      const failed = yield* w.service.commands.challenge(w.session, record).pipe(Effect.result);
      assert.isTrue(Result.isFailure(failed));
      if (Result.isFailure(failed)) {
        assert.instanceOf(failed.failure, PeerHubError);
        assert.notStrictEqual((failed.failure as PeerHubError).refused, true);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("lists the project's challenges and shows one, from the Hub's view now", () =>
    Effect.gen(function* () {
      const elsewhere = challenge("ch-9", { project: "other" });
      const w = yield* served(2, () => [200, { ...view(), challenges: [bobs("ch-1"), elsewhere] }]);
      const listed = yield* w.service.commands.challenge(w.session, {
        _tag: "challenge",
        form: "list",
      });
      assert.include(listed, "* ch-1 · open · src/money.ts#formatPrice");
      assert.notInclude(listed, "ch-9");
      const shown = yield* w.service.commands.challenge(w.session, {
        _tag: "challenge",
        form: "show",
        id: "ch-1",
      });
      assert.include(shown, "takes euros as a decimal, not cents");
      const unknown = yield* w.service.commands
        .challenge(w.session, { _tag: "challenge", form: "show", id: "ch-9" })
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(unknown));
    }).pipe(Effect.scoped),
  );
});

describe("what a session hears of challenges at its steps", () => {
  it.effect("hears one once, again when its reason changes, and its close once", () =>
    Effect.gen(function* () {
      let challenges = [bobs("ch-1")];
      const w = yield* world(() => [200, { ...view([]), challenges }]);
      yield* reread(w);
      const first = (yield* step(w)) ?? "";
      assert.include(first, "challenges formatPrice (src/money.ts), which your plan uses.");
      assert.include(first, "- takes euros as a decimal, not cents");
      assert.isNull(yield* step(w));
      challenges = [bobs("ch-1", { reason: "takes a string", updatedAt: "2026-10-12T20:05:00Z" })];
      yield* reread(w);
      assert.include((yield* step(w)) ?? "", "- takes a string");
      assert.isNull(yield* step(w));
      challenges = [bobs("ch-1", closedBy(theirs(), "my mistake"))];
      yield* reread(w);
      const close = (yield* step(w)) ?? "";
      assert.include(
        close,
        "closed the challenge of formatPrice (src/money.ts) (ch-1). Note (teammate text):",
      );
      assert.include(close, "- my mistake");
      assert.isNull(yield* step(w));
      const told = w.logged.filter((line) => line.event === "plans.challenge.told");
      assert.deepStrictEqual(
        told.map((line) => line.fields.kind),
        ["open", "open", "close"],
      );
      assert.deepStrictEqual(Object.keys(told[0]?.fields ?? {}).sort(), [
        "chars",
        "kind",
        "session",
      ]);
      assert.notInclude(JSON.stringify(w.logged), "formatPrice");
      assert.notInclude(JSON.stringify(w.logged), "mistake");
    }).pipe(Effect.scoped),
  );

  it.effect(
    "never hears a challenge closed before it heard it, nor its own, nor its own close",
    () =>
      Effect.gen(function* () {
        let challenges = [
          bobs("ch-2", closedBy(theirs())),
          challenge("ch-3", { by: mine(), meets: [{ side: mine(), role: "uses" }] }),
          bobs("ch-4", { meets: [{ side: mine(), role: "provides", contract: "cents" }] }),
        ];
        const w = yield* world(() => [200, { ...view([]), challenges }]);
        yield* reread(w);
        const heard = (yield* step(w)) ?? "";
        assert.include(heard, "(src/money.ts), which your plan provides.");
        assert.include(heard, "Your contract line: cents.");
        assert.notInclude(heard, "ch-2");
        assert.notInclude(heard, "ch-3");
        assert.isNull(yield* step(w));
        // Its own challenge closed by another work: the challenger hears that. Its own close: nothing.
        challenges = [
          challenge("ch-3", { by: mine(), meets: [], ...closedBy(theirs(), "fixed") }),
          bobs("ch-4", closedBy(mine(), "settled")),
        ];
        yield* reread(w);
        const closes = (yield* step(w)) ?? "";
        assert.include(closes, "(ch-3)");
        assert.notInclude(closes, "ch-4");
        assert.isNull(yield* step(w));
      }).pipe(Effect.scoped),
  );

  it.effect("hears its open challenges once more after a compaction, and never wakes for one", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [200, { ...view([]), challenges: [bobs("ch-1")] }]);
      yield* reread(w);
      assert.isNull(yield* step(w, { waking: true }));
      assert.isNotNull(yield* step(w));
      assert.isNull(yield* step(w));
      yield* w.service.started({
        session: w.session,
        event: "session-start",
        source: "compact",
        remainingMs: 1_000,
      });
      assert.include((yield* step(w)) ?? "", "ch-1");
    }).pipe(Effect.scoped),
  );

  it.effect("counts challenges with relations, three a step", () =>
    Effect.gen(function* () {
      const w = yield* world(() => [
        200,
        {
          ...view([rel("r1"), rel("r2", { item: { path: "src/b.ts" } })]),
          challenges: [bobs("ch-1"), bobs("ch-2")],
        },
      ]);
      yield* reread(w);
      const first = (yield* step(w)) ?? "";
      assert.include(first, "Further challenges: peer plan challenge (1 more)");
      assert.include((yield* step(w)) ?? "", "ch-2");
      assert.isNull(yield* step(w));
    }).pipe(Effect.scoped),
  );

  it.effect("logs a challenge that lapsed with how many sessions it was told to", () =>
    Effect.gen(function* () {
      let challenges = [bobs("ch-1"), bobs("ch-2", closedBy(theirs()))];
      const w = yield* world(() => [200, { ...view([]), challenges }]);
      yield* reread(w);
      yield* step(w);
      challenges = [];
      yield* reread(w);
      assert.deepStrictEqual(
        w.logged
          .filter((line) => line.event === "plans.challenge.lapsed")
          .map((line) => line.fields),
        [{ told: 1 }],
      );
    }).pipe(Effect.scoped),
  );

  it.effect("lists the open challenges a declared plan meets, and does not tell them again", () =>
    Effect.gen(function* () {
      const challenges = [bobs("ch-1"), challenge("ch-3", { by: mine() })];
      const w = yield* world((call) =>
        call.method === "PUT"
          ? [200, { ...declared(true, []), challenges }]
          : [200, { ...view([]), challenges }],
      );
      const answer = yield* declare(w);
      assert.deepStrictEqual(
        answer.challenges?.map((one) => one.id),
        ["ch-1"],
      );
      assert.strictEqual(answer.challenged, 1);
      yield* reread(w);
      assert.isNull(yield* step(w));
    }).pipe(Effect.scoped),
  );
});
