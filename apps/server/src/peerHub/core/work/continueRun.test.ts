// @effect-diagnostics nodeBuiltinImport:off - a task's checkout in a temporary directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { RunsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import * as PeerHub from "../../PeerHub.ts";
import { brokerFixture } from "../broker/testkit.ts";
import * as PeerAdapters from "../coordination/PeerAdapters.ts";
import * as PeerAgents from "../coordination/PeerAgents.ts";
import * as PeerCoordination from "../coordination/PeerCoordination.ts";
import {
  bindPlugin,
  type PeerLifecycleEvent,
  type PeerRpcWrap,
  type PeerTaskLauncher,
} from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerWork from "./PeerWork.ts";
import * as PeerHubClient from "../hub/PeerHubClient.ts";
import { coreLayer, meAnswer, paymentsSeed, seedState, standInHub } from "../testkit.ts";
import * as PeerRuns from "./runs.ts";
import { stateOf } from "./runs.ts";

/** The folder the stand-in launcher makes a new checkout in, under the one it was told. */
const NEW_CHECKOUT = "KRK-1-new";
const FOREIGN = "run_FOREIGN00000000000";
/** Ana's own run that her other computer minted and left detached. */
const DESK = "run_DESK0000000000000000";
const deskView = {
  id: DESK,
  workspace: "acme",
  project: "pay",
  task: "krk-1",
  email: "ana@acme.test",
  environment: "ana-desk",
  agent: "claude",
  runtime: "herdr",
  startedAt: "2026-10-30T08:00:00.000Z",
  state: "detached",
  sessions: [
    { id: "claude:desk-1", from: "2026-10-30T08:00:00.000Z", to: "2026-10-30T08:30:00.000Z" },
  ],
  sessionsBefore: 0,
};
const task = {
  id: "krk-1",
  key: "KRK-1",
  title: "Split payments",
  status: "open",
  createdBy: "ana@acme.test",
  createdAt: "2026-10-09",
  updatedAt: "2026-10-09",
};

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
  // What herdr's task launcher was asked to start, through a stand-in for the plugin.
  const launched: Array<Parameters<PeerTaskLauncher["launch"]>[0]> = [];
  const open: { current: { readonly open: boolean; readonly refused?: string } } = {
    current: { open: false },
  };
  const toldOpen: Array<string> = [];
  const created: Array<PeerLifecycleEvent> = [];
  const herdr = bindPlugin({
    id: "herdr",
    title: "herdr",
    summary: "test",
    defaultEnabled: true,
    layer: Layer.empty,
    make: Effect.succeed({
      taskWorktreeCreated: (event) => Effect.sync(() => void created.push(event)),
      taskLauncher: {
        unavailable: Effect.succeed(null),
        continueOpen: (asked) =>
          Effect.sync(() => {
            if (open.current.open) toldOpen.push(asked.prompt);
            return open.current;
          }),
        launch: (asked) =>
          Effect.sync(() => {
            launched.push(asked);
            const made = NodePath.join(asked.worktrees, NEW_CHECKOUT);
            return {
              paneId: "pane-9",
              terminalId: "term-9",
              threadKey: "herdr:term-9",
              root: asked.reuse ?? made,
              ...(asked.reuse === undefined ? { worktree: { root: made, identity: "1:2" } } : {}),
            };
          }),
      },
    }),
  });
  /** How the Hub answers Ana's other computer's run: handed over, or refused with a code. */
  const desk: { answer: readonly [number, unknown]; me: unknown } = {
    me: {},
    answer: [
      200,
      {
        run: {
          ...deskView,
          environment: "ana-laptop",
          environments: [
            { id: "ana-desk", from: "2026-10-30T08:00:00.000Z" },
            { id: "ana-laptop", from: "2026-10-30T09:00:00.000Z" },
          ],
        },
        changed: true,
      },
    ],
  };
  const hub = yield* standInHub({
    current: (url, method) =>
      url === "/v1/me"
        ? [200, desk.me]
        : method === "PATCH" && url === `/v1/workspaces/acme/runs/pay/${FOREIGN}`
          ? [200, { run: foreignView, changed: true }]
          : method === "PATCH" && url === `/v1/workspaces/acme/runs/pay/${DESK}`
            ? (desk.answer as [number, unknown])
            : method === "GET" && url.startsWith("/v1/workspaces/acme/runs/pay")
              ? [200, { runs: [deskView, foreignView] }]
              : url.endsWith("/work")
                ? [200, { projects: { pay: { areas: [], tasks: [task], threads: [] } } }]
                : [200, {}],
  });
  const core = yield* Layer.build(
    coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "person", plugins: [herdr] }),
  );
  yield* PeerPlugins.startPlugins.pipe(Effect.provide(core));
  yield* (yield* PeerWork.PeerWork.pipe(Effect.provide(core))).readWork("acme");
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
  yield* (yield* PeerAgents.PeerAgents.pipe(Effect.provide(core))).attach(fixture.broker);
  const handlers = PeerHub.rpcLayer(wrap).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeedContext(core),
        Layer.mock(PeerCoordination.PeerCoordination)({
          broker: () => fixture.broker,
          paths: {} as never,
        }),
        Layer.mock(PeerAdapters.PeerAdapters)({} as never),
      ),
    ),
  );
  const client = yield* RpcTest.makeClient(RunsRpcGroup).pipe(Effect.provide(handlers));
  return { hub, runs, queued, fixture, client, launched, created, desk, core, open, toldOpen };
});

/** A run of this computer whose one session ended. */
const detached = (
  runs: PeerRuns.PeerRuns["Service"],
  runtime: "peer" | "terminal" | "herdr",
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

const gitIn = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Ana",
      GIT_AUTHOR_EMAIL: "ana@acme.test",
      GIT_COMMITTER_NAME: "Ana",
      GIT_COMMITTER_EMAIL: "ana@acme.test",
    },
  });

/** A task's checkout on a branch of its own off `main`, with nothing on it yet. */
const taskCheckout = Effect.acquireRelease(
  Effect.sync(() => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-continue-"));
    gitIn(directory, "init", "--quiet", "--initial-branch=main");
    gitIn(directory, "commit", "--quiet", "--allow-empty", "-m", "start");
    gitIn(directory, "switch", "--quiet", "-c", "feature/krk-1");
    return directory;
  }),
  (directory) => Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
);

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

describe("continuing a herdr run", () => {
  it.effect("relaunches it in herdr resuming its last session, with a new token", () =>
    Effect.gen(function* () {
      const { runs, client, launched } = yield* setup;
      const id = yield* detached(runs, "herdr", "claude:native-4");
      const before = runs.book.get(id)!.tokenHash;
      assert.deepStrictEqual(yield* client["peerHub.continueRun"]({ ...place, runId: id }), {
        started: true,
      });
      assert.strictEqual(launched.length, 1);
      assert.deepStrictEqual(launched[0]!.resume, { agent: "claude", session: "native-4" });
      assert.strictEqual(launched[0]!.env.PEER_RUN, id);
      assert.strictEqual(launched[0]!.env.PEER_TASK, "krk-1");
      assert.notStrictEqual(runs.book.get(id)!.tokenHash, before);
      assert.isTrue(runs.book.claim(id, launched[0]!.env.PEER_RUN_TOKEN));
      // The new pane is the run's, so the work view and Observe find it.
      assert.strictEqual(runs.book.holderOf("herdr:term-9")?.id, id);
      assert.strictEqual(runs.book.get(id)!.pane, "pane-9");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("tells the agent still open in its pane and starts no second one", () =>
    Effect.gen(function* () {
      const { runs, client, launched, open, toldOpen } = yield* setup;
      const id = yield* detached(runs, "herdr", "claude:native-4");
      open.current = { open: true };
      assert.deepStrictEqual(yield* client["peerHub.continueRun"]({ ...place, runId: id }), {
        started: true,
      });
      assert.strictEqual(launched.length, 0);
      assert.strictEqual(toldOpen.length, 1);
      assert.include(toldOpen[0]!, id);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says why an open agent could not be told, and starts no second one", () =>
    Effect.gen(function* () {
      const { runs, client, launched, open } = yield* setup;
      const id = yield* detached(runs, "herdr", "claude:native-4");
      open.current = { open: true, refused: "Answer it in herdr first." };
      assert.deepStrictEqual(yield* client["peerHub.continueRun"]({ ...place, runId: id }), {
        started: false,
        reason: "Answer it in herdr first.",
      });
      assert.strictEqual(launched.length, 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("goes on in the checkout it left when that holds work", () =>
    Effect.gen(function* () {
      const { runs, client, launched, created } = yield* setup;
      const tree = yield* taskCheckout;
      const id = yield* detached(runs, "herdr", "claude:native-4");
      yield* Effect.promise(() => runs.book.hold(id, "herdr:term-1", "pane-1", tree));
      NodeFS.writeFileSync(NodePath.join(tree, "work.ts"), "1\n");
      gitIn(tree, "add", ".");
      gitIn(tree, "commit", "--quiet", "-m", "the work");

      assert.deepStrictEqual(yield* client["peerHub.continueRun"]({ ...place, runId: id }), {
        started: true,
      });

      assert.strictEqual(launched[0]!.reuse, tree);
      assert.strictEqual(runs.book.get(id)!.root, tree);
      assert.deepStrictEqual(created, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("starts again on the model and effort its author chose", () =>
    Effect.gen(function* () {
      const { runs, client, launched } = yield* setup;
      const { run } = yield* Effect.promise(() =>
        runs.book.create({
          workspace: "acme",
          project: "pay",
          task: "krk-1",
          agent: "claude",
          runtime: "herdr",
          model: "claude-haiku-5-5",
          effort: "low",
        }),
      );
      yield* client["peerHub.continueRun"]({ ...place, runId: run.id });
      assert.strictEqual(launched[0]!.model, "claude-haiku-5-5");
      assert.strictEqual(launched[0]!.effort, "low");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("starts from the base when the checkout it left holds nothing", () =>
    Effect.gen(function* () {
      const { runs, client, launched, created } = yield* setup;
      const tree = yield* taskCheckout;
      const id = yield* detached(runs, "herdr", "claude:native-4");
      yield* Effect.promise(() => runs.book.hold(id, "herdr:term-1", "pane-1", tree));

      assert.deepStrictEqual(yield* client["peerHub.continueRun"]({ ...place, runId: id }), {
        started: true,
      });

      assert.isUndefined(launched[0]!.reuse);
      const root = NodePath.join(launched[0]!.worktrees, NEW_CHECKOUT);
      assert.strictEqual(runs.book.get(id)!.root, root);
      assert.deepStrictEqual(created, [
        {
          kind: "task-worktree-created",
          workspace: "acme",
          project: "pay",
          repository: "api",
          task: "krk-1",
          thread: "herdr:term-9",
          root,
          identity: "1:2",
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("continuing a run of another computer of the same person", () => {
  it.effect(
    "asks the Hub to hand it over, keeps it here and continues it on the task's prompt",
    () =>
      Effect.gen(function* () {
        const { runs, client, launched, hub } = yield* setup;
        assert.deepStrictEqual(yield* client["peerHub.continueRun"]({ ...place, runId: DESK }), {
          started: true,
        });
        const patch = hub.calls.find(
          (call) => call.method === "PATCH" && call.url === `/v1/workspaces/acme/runs/pay/${DESK}`,
        )!;
        assert.deepStrictEqual(JSON.parse(patch.body), { environment: "ana-laptop" });
        const kept = runs.book.get(DESK)!;
        assert.strictEqual(kept.environment, "ana-laptop");
        assert.isTrue(runs.book.claim(DESK, launched[0]!.env.PEER_RUN_TOKEN));
        // Its provider session is on the desk: nothing to resume here.
        assert.isUndefined(launched[0]!.resume);
        assert.include(launched[0]!.prompt, `You continue run ${DESK}`);
        const listed = yield* client["peerHub.runs"]({ ...place, taskId: "krk-1" });
        const row = listed.runs.find((run) => run.id === DESK)!;
        assert.strictEqual(row.environment, "ana-laptop");
        assert.deepStrictEqual(
          row.environments?.map((entry) => entry.id),
          ["ana-desk", "ana-laptop"],
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says a Hub at runs revision 1 does not move runs, and asks it nothing", () =>
    Effect.gen(function* () {
      const { runs, client, launched, hub, desk, core } = yield* setup;
      desk.me = meAnswer({ runs: 1 });
      yield* (yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core))).me;
      assert.deepStrictEqual(yield* client["peerHub.continueRun"]({ ...place, runId: DESK }), {
        started: false,
        reason: "This Peer Hub does not move runs between computers yet.",
      });
      assert.isFalse(hub.calls.some((call) => call.method === "PATCH"));
      assert.isUndefined(runs.book.get(DESK));
      assert.deepStrictEqual(launched, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says why the Hub refused, and keeps nothing", () =>
    Effect.gen(function* () {
      const { runs, client, launched, desk } = yield* setup;
      desk.answer = [409, { error: { code: "ended", message: "the run ended" } }];
      assert.deepStrictEqual(yield* client["peerHub.continueRun"]({ ...place, runId: DESK }), {
        started: false,
        reason: "This run has ended.",
      });
      desk.answer = [403, { error: { code: "not_your_run", message: "not yours" } }];
      assert.deepStrictEqual(yield* client["peerHub.continueRun"]({ ...place, runId: DESK }), {
        started: false,
        reason: "This run is another person's; only its person continues it.",
      });
      assert.isUndefined(runs.book.get(DESK));
      assert.deepStrictEqual(launched, []);
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
