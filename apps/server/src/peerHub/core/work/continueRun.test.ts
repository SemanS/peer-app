import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { RunsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import * as PeerHub from "../../PeerHub.ts";
import { brokerFixture } from "../broker/testkit.ts";
import * as PeerAdapters from "../coordination/PeerAdapters.ts";
import * as PeerCoordination from "../coordination/PeerCoordination.ts";
import * as PeerContextView from "../index/PeerContextView.ts";
import type { PeerRpcWrap } from "../plugin.ts";
import { coreLayer, paymentsSeed, seedState, standInHub } from "../testkit.ts";
import * as PeerRuns from "./runs.ts";
import { stateOf } from "./runs.ts";

const FOREIGN = "run_FOREIGN00000000000";
/** Another computer's run as the Hub keeps it. */
const foreignView = {
  id: FOREIGN,
  workspace: "acme",
  project: "pay",
  task: "krk-1",
  email: "bob@acme.test",
  environment: "bob-laptop",
  agent: "codex",
  runtime: "herdr",
  startedAt: "2026-10-30T09:00:00.000Z",
  endedAt: "2026-10-30T10:00:00.000Z",
  outcome: "stopped",
  state: "ended",
  sessions: [],
  sessionsBefore: 0,
};

const wrap: PeerRpcWrap = {
  effect: (_method, effect) => effect,
  stream: (_method, stream) => stream,
};

/**
 * Ana's core on a stand-in Hub, a running broker over her runs whose host wakes Peer threads into
 * `queued`, and the runs methods as a client calls them.
 */
const setup = Effect.gen(function* () {
  const hub = yield* standInHub({
    current: (url, method) =>
      method === "PATCH" && url === `/v1/workspaces/acme/runs/pay/${FOREIGN}`
        ? [200, { run: foreignView, changed: true }]
        : [200, {}],
  });
  const core = yield* Layer.build(
    coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "person" }),
  );
  const runs = yield* PeerRuns.PeerRuns.pipe(Effect.provide(core));
  const queued: Array<readonly [string, string, string]> = [];
  const fixture = yield* Effect.acquireRelease(
    Effect.promise(() =>
      brokerFixture((host) => ({
        runs: runs.book,
        placeOf: async (cwd) => {
          const place = await host.placeOf(cwd);
          return place === null ? null : { ...place, project: "pay" };
        },
        taskOf: () => "krk-1",
        queueNative: async (session, text, thread) => {
          queued.push([session, text, thread]);
          return true;
        },
      })),
    ),
    (made) => Effect.promise(() => made.dispose()),
  );
  yield* Effect.promise(() => fixture.broker.start());
  const handlers = PeerHub.rpcLayer(wrap).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeedContext(core),
        Layer.mock(PeerCoordination.PeerCoordination)({
          broker: () => fixture.broker,
          paths: {} as never,
        }),
        Layer.mock(PeerContextView.PeerContextView)({} as never),
        Layer.mock(PeerAdapters.PeerAdapters)({} as never),
      ),
    ),
  );
  const client = yield* RpcTest.makeClient(RunsRpcGroup).pipe(Effect.provide(handlers));
  return { hub, runs, queued, fixture, client };
});

/** A run of this computer whose one session ended. */
const detached = (
  runs: PeerRuns.PeerRuns["Service"],
  runtime: "peer" | "terminal",
  session: string,
) =>
  Effect.promise(async () => {
    const { run } = await runs.book.create({
      workspace: "acme",
      project: "pay",
      task: "krk-1",
      agent: "claude",
      runtime,
      ...(runtime === "peer" ? { thread: "peer:thread-9" } : {}),
    });
    await runs.book.attach(run.id, session);
    await runs.book.detach(run.id, session);
    return run.id;
  });

const place = { workspace: "acme", projectId: "pay" };

describe("continuing a run", () => {
  it.effect("wakes a detached Peer thread's run through its last session", () =>
    Effect.gen(function* () {
      const { runs, queued, client } = yield* setup;
      const id = yield* detached(runs, "peer", "claude:native-9");
      const answer = yield* client["peerHub.continueRun"]({ ...place, runId: id });
      assert.deepStrictEqual(answer, { started: true });
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0]![0], "claude:native-9");
      assert.strictEqual(queued[0]![2], "peer:thread-9");
      assert.include(queued[0]![1], id);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "sends a terminal run back to the terminal, and refuses what is not detached here",
    () =>
      Effect.gen(function* () {
        const { runs, queued, client } = yield* setup;
        const id = yield* detached(runs, "terminal", "claude:native-1");
        assert.deepStrictEqual(yield* client["peerHub.continueRun"]({ ...place, runId: id }), {
          started: false,
          reason: `continue it with peer core runs continue ${id}`,
        });
        assert.isFalse(
          (yield* client["peerHub.continueRun"]({ ...place, runId: FOREIGN })).started,
        );
        yield* Effect.promise(() => runs.book.end(id, "done"));
        assert.deepStrictEqual(yield* client["peerHub.continueRun"]({ ...place, runId: id }), {
          started: false,
          reason: "This run has ended.",
        });
        assert.deepStrictEqual(queued, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("ending a run", () => {
  it.effect("ends this computer's run as stopped and releases its session's claims", () =>
    Effect.gen(function* () {
      const { runs, fixture, client, hub } = yield* setup;
      yield* Effect.promise(() =>
        fixture.broker.hookInTime(
          {
            session_id: "one",
            cwd: fixture.root,
            hook_event_name: "SessionStart",
            source: "startup",
          },
          { "x-peer-agent": "claude" },
        ),
      );
      const session = fixture.broker.sessions.get("claude:one")!;
      session.claims = ["pay.ts"];
      const ended = yield* client["peerHub.endRun"]({ ...place, runId: session.run! });
      assert.deepStrictEqual(
        [ended.id, ended.state, ended.outcome],
        [session.run, "ended", "stopped"],
      );
      assert.strictEqual(stateOf(runs.book.get(session.run!)!), "ended");
      assert.deepStrictEqual(session.claims, []);
      assert.isFalse(hub.calls.some((call) => call.method === "PATCH"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("asks the Hub to end another computer's run", () =>
    Effect.gen(function* () {
      const { client, hub } = yield* setup;
      const ended = yield* client["peerHub.endRun"]({ ...place, runId: FOREIGN });
      assert.deepStrictEqual([ended.id, ended.state], [FOREIGN, "ended"]);
      const patch = hub.calls.find((call) => call.method === "PATCH")!;
      assert.strictEqual(patch.url, `/v1/workspaces/acme/runs/pay/${FOREIGN}`);
      assert.strictEqual((JSON.parse(patch.body) as { outcome?: string }).outcome, "stopped");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
