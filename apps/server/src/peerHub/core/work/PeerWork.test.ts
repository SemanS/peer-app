import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  runTaskOf,
  type PeerAgentView,
  type PeerPluginId,
  type PeerWorkThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../../../project/ProjectService.ts";

import type { ReportedThread } from "../hub/hubApi.ts";
import { bindPlugin, type PeerContributions, type PeerPluginEntry } from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import {
  coreLayer,
  paymentsSeed,
  paymentsT3,
  SEED_RUN,
  seedState,
  standInHub,
  type HubAnswer,
  type HubCall,
} from "../testkit.ts";
import * as PeerWork from "./PeerWork.ts";
import * as PeerStatus from "../status/PeerStatus.ts";

/** Work this computer reported before and no longer runs: the Hub keeps it in its ledger. */
const dormant: PeerWorkThread = {
  id: "herdr:t-old",
  title: "Old work",
  email: "ana@acme.test",
  status: "idle",
  branch: "fix/rounding",
  source: "herdr",
  environment: "ana-laptop",
  seenAt: "2026-10-08T10:00:00Z",
};

/** What a stand-in Hub answers: the work, and it takes any report. */
const hubAnswers: HubAnswer = (url) =>
  url === "/v1/workspaces/acme/work"
    ? [200, { projects: { pay: { areas: [], tasks: [], threads: [dormant] } } }]
    : [200, {}];

/** A plugin that runs one agent beside Peer's threads and lets the team watch thread-1. */
const runtimePlugin = (id: PeerPluginId): PeerPluginEntry => {
  const gone: PeerAgentView = { agentId: "", title: "", status: "unknown", gone: true };
  const contributions: PeerContributions = {
    runtime: {
      prefix: "pane:",
      title: () => undefined,
      pane: () => undefined,
      status: () => undefined,
      wake: () => Effect.succeed({ status: "unavailable" }),
      view: () => Effect.succeed(gone),
      threads: (workspace) =>
        Effect.succeed(
          workspace === "acme"
            ? [
                {
                  id: "pane:7",
                  project: "pay",
                  title: "Review the refund flow",
                  status: "idle",
                  source: "herdr",
                },
              ]
            : [],
        ),
    },
    threadReport: (thread) => ({ observable: thread === "peer:thread-1" }),
  };
  return bindPlugin({
    id,
    title: id,
    summary: "A plugin for tests.",
    defaultEnabled: true,
    layer: Layer.empty,
    make: Effect.succeed(contributions),
  });
};

/** Core reporting to a stand-in Hub, with `plugins` started; the threads it reported, by call. */
const reporting = (
  plugins: ReadonlyArray<PeerPluginEntry>,
  answer: HubAnswer = hubAnswers,
  t3 = paymentsT3,
) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: answer });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url)), {
        session: "phs_test",
        plugins,
        t3,
      }),
    );
    const reported = (calls: ReadonlyArray<HubCall>) =>
      calls
        .filter((call) => call.method === "PUT" && call.url === "/v1/workspaces/acme/threads")
        .map(
          (call) =>
            JSON.parse(call.body) as {
              readonly environment: string;
              readonly threads: ReadonlyArray<ReportedThread>;
            },
        );
    return yield* Effect.gen(function* () {
      yield* PeerPlugins.startPlugins;
      const state = yield* PeerState.PeerState;
      // What Peer read before: the dormant work this computer reported last time.
      yield* state.updateRuntime((s) => ({
        ...s,
        work: new Map([["acme/pay", { areas: [], tasks: [], threads: [dormant] }]]),
      }));
      return {
        work: yield* PeerWork.PeerWork,
        status: yield* PeerStatus.PeerStatus,
        plugins: yield* PeerPlugins.PeerPlugins,
        state,
        report: () => reported(hub.calls),
        calls: () => hub.calls,
      };
    }).pipe(Effect.provide(core));
  });

/** Peer's own thread as it was always reported. */
const peerThread: ReportedThread = {
  id: "peer:thread-1",
  project: "pay",
  repository: "api",
  task: "krk-1",
  title: "Split payments",
  status: "working",
  harness: "claude",
  branch: "feat/split",
  source: "peer",
  runtimePresent: true,
};

const dormantThread: ReportedThread = {
  id: "herdr:t-old",
  project: "pay",
  title: "Old work",
  status: "unknown",
  source: "herdr",
  runtimePresent: false,
  observable: false,
  branch: "fix/rounding",
};

describe("local thread snapshots", () => {
  it.effect("keeps the local report before the Hub answers and retains a skipped workspace", () =>
    Effect.gen(function* () {
      const { work, state, report } = yield* reporting([], () => [503, {}]);
      yield* work.refresh();
      const local = yield* work.localThreads;
      assert.deepStrictEqual(local.get("acme"), report()[0]!.threads);
      assert.isTrue(local.get("acme")!.some((thread) => thread.id === "peer:thread-1"));
      yield* state.updatePersisted((s) => ({
        ...s,
        workspaces: s.workspaces.map((w) => ({ ...w, manifest: null })),
      }));
      yield* work.refresh();
      assert.deepStrictEqual(yield* work.localThreads, local);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

const releasedNativeT3 = (
  input: {
    readonly driver?: string;
    readonly sessionStatus?: Effect.Effect<string>;
    readonly resumeOnWake?: boolean;
    readonly providerStatus?: string;
    readonly worktreePath?: string | null;
    readonly projectId?: string;
    readonly archivedAt?: string | null;
    readonly deletedAt?: string | null;
    readonly nativeId?: string | null;
    readonly activeProviderThreadId?: string;
  } = {},
) =>
  Layer.mergeAll(
    paymentsT3,
    Layer.mock(ProjectService.ProjectService)({
      getByWorkspaceRoot: (root) =>
        Effect.succeed(
          root.endsWith("/acme/pay/api")
            ? Option.some({ id: "t3-pay", workspaceRoot: root } as never)
            : Option.none(),
        ),
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getShellSnapshot: () =>
        Effect.succeed({
          threads: [
            {
              id: "thread-1",
              projectId: input.projectId ?? "t3-pay",
              title: "Split payments",
              providerInstanceId: "claude-1",
              activeProviderThreadId: input.activeProviderThreadId ?? "provider-1",
              branch: "feat/split",
              status: "idle",
              activityRunStatus: null,
              pendingRuntimeRequest: null,
              settledAt: null,
              archivedAt: input.archivedAt ?? null,
              deletedAt: input.deletedAt ?? null,
              worktreePath: input.worktreePath ?? null,
            },
          ],
        } as never),
      getThreadRecords: () =>
        (input.sessionStatus ?? Effect.succeed("stopped")).pipe(
          Effect.map(
            (status) =>
              ({
                providerThreads: [
                  {
                    id: "provider-1",
                    driver: input.driver ?? "claudeAgent",
                    status: input.providerStatus ?? "idle",
                    providerSessionId: "session-1",
                    nativeThreadRef:
                      input.nativeId === null ? null : { nativeId: input.nativeId ?? "native-1" },
                  },
                ],
                providerSessions: [
                  { id: "session-1", status, resumeOnWake: input.resumeOnWake ?? true },
                ],
              }) as never,
          ),
        ),
    }),
  );

describe("resumable native threads", () => {
  it.effect.each([
    { driver: "claudeAgent", agent: "claude", worktreePath: null },
    { driver: "codex", agent: "codex", worktreePath: "/worktrees/payments-coupon" },
  ])("retains the native $agent identity and checkout after idle release", (fixture) =>
    Effect.gen(function* () {
      const { work, state, report } = yield* reporting([], hubAnswers, releasedNativeT3(fixture));
      assert.deepStrictEqual(yield* work.resumableThreads, []);

      yield* work.refresh();

      const persisted = (yield* state.read).persisted;
      assert.deepStrictEqual(yield* work.resumableThreads, [
        {
          thread: "peer:thread-1",
          agent: fixture.agent,
          nativeId: "native-1",
          cwd: fixture.worktreePath ?? state.checkoutPath(persisted, "acme", "pay", "api"),
        },
      ]);
      assert.isFalse(
        report()[0]?.threads.find((thread) => thread.id === "peer:thread-1")?.runtimePresent,
      );
      assert.isNull(work.runtimeOf("peer:thread-1", `${fixture.agent}:native-1`));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect.each([
    { reason: "a live runtime", sessionStatus: Effect.succeed("ready") },
    { reason: "manual shutdown", resumeOnWake: false },
    { reason: "an archived thread", archivedAt: "2026-10-21T10:00:00Z" },
    { reason: "a deleted thread", deletedAt: "2026-10-21T10:00:00Z" },
    { reason: "an unbound project", projectId: "outside-workspace" },
    { reason: "an unsupported harness", driver: "opencode" },
    { reason: "an active provider turn", providerStatus: "active" },
    { reason: "a missing native identity", nativeId: null },
    { reason: "a different active provider thread", activeProviderThreadId: "provider-2" },
  ])("does not offer automatic resume for $reason", (fixture) =>
    Effect.gen(function* () {
      const { work } = yield* reporting([], hubAnswers, releasedNativeT3(fixture));
      yield* work.refresh();
      assert.deepStrictEqual(yield* work.resumableThreads, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("uses the last report's metadata until refresh observes the native runtime again", () =>
    Effect.gen(function* () {
      const status = yield* Ref.make("stopped");
      const { work, report } = yield* reporting(
        [],
        hubAnswers,
        releasedNativeT3({ sessionStatus: Ref.get(status) }),
      );
      yield* work.refresh();
      const released = yield* work.resumableThreads;
      assert.equal(released.length, 1);

      yield* Ref.set(status, "ready");
      assert.deepStrictEqual(yield* work.resumableThreads, released);
      yield* work.refresh();

      assert.deepStrictEqual(yield* work.resumableThreads, []);
      assert.isTrue(
        report()[1]?.threads.find((thread) => thread.id === "peer:thread-1")?.runtimePresent,
      );
      assert.equal(work.runtimeOf("peer:thread-1", "claude:native-1"), "idle");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("expires resumable metadata when the native report is no longer current", () =>
    Effect.gen(function* () {
      const { work } = yield* reporting([], hubAnswers, releasedNativeT3());
      yield* work.refresh();
      assert.equal((yield* work.resumableThreads).length, 1);

      yield* TestClock.adjust("3 minutes");

      assert.deepStrictEqual(yield* work.resumableThreads, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("the work report", () => {
  it.effect("reports a persisted automatic branch rename explicitly", () =>
    Effect.gen(function* () {
      const t3 = Layer.merge(
        paymentsT3,
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getShellSnapshot: () =>
            Effect.succeed({
              threads: [
                {
                  id: "thread-1",
                  projectId: "t3-pay",
                  title: "Split payments",
                  providerInstanceId: "claude-1",
                  branch: "feat/split",
                  branchRenamedFrom: "scratch-worktree",
                  status: "running",
                  pendingRuntimeRequest: null,
                  settledAt: null,
                },
              ],
            } as never),
          getThreadRecords: () =>
            Effect.succeed({ providerThreads: [], providerSessions: [] } as never),
        }),
      );
      const { work, report } = yield* reporting([], hubAnswers, t3);
      yield* work.refresh();
      assert.equal(
        report()[0]?.threads.find((t) => t.id === "peer:thread-1")?.branchRenamedFrom,
        "scratch-worktree",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("tells each workspace of Peer's own threads and its dormant work, as before", () =>
    Effect.gen(function* () {
      const { work, state, report } = yield* reporting([]);
      yield* work.refresh();
      assert.deepStrictEqual(report(), [
        { environment: "ana-laptop", threads: [peerThread, dormantThread] },
      ]);
      // What was read back replaces the work, and the native runtime is known for the broker.
      assert.deepStrictEqual((yield* state.read).work.get("acme/pay")?.threads, [dormant]);
      assert.strictEqual(work.runtimeOf("peer:thread-1", "claude:native-1"), "working");
      assert.isNull(work.runtimeOf("peer:thread-1", "claude:another"));
      assert.strictEqual(yield* work.taskName("acme", "pay", "krk-1"), "krk-1");
      assert.deepStrictEqual(
        yield* work.runOf("peer:thread-1"),
        Option.some({ id: SEED_RUN, workspace: "acme", project: "pay", task: "krk-1" }),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("adds a runtime plugin's threads and what plugins say of each thread", () =>
    Effect.gen(function* () {
      const { work, report } = yield* reporting([runtimePlugin("herdr")]);
      yield* work.refresh();
      assert.deepStrictEqual(report(), [
        {
          environment: "ana-laptop",
          threads: [
            { ...peerThread, observable: true },
            {
              id: "pane:7",
              project: "pay",
              title: "Review the refund flow",
              status: "idle",
              source: "herdr",
            },
            dormantThread,
          ],
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves out what an inactive plugin would add", () =>
    Effect.gen(function* () {
      const { work, plugins, report } = yield* reporting([runtimePlugin("herdr")]);
      yield* plugins.setPlugin({ id: "herdr", enabled: false });
      yield* work.refresh();
      assert.deepStrictEqual(report(), [
        { environment: "ana-laptop", threads: [peerThread, dormantThread] },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

it.effect(
  "returns the created task even when refreshed work also contains another person’s task",
  () =>
    Effect.gen(function* () {
      const task = (id: string) => ({
        id,
        title: "Same title",
        status: "open",
        createdBy: "ana@acme.test",
        createdAt: "now",
        updatedAt: "now",
      });
      const { work, status } = yield* reporting([], (path) =>
        path === "/v1/workspaces/acme/projects/pay/tasks"
          ? [201, task("mine")]
          : path === "/v1/workspaces/acme/work"
            ? [
                200,
                {
                  projects: {
                    pay: { areas: [], tasks: [task("other"), task("mine")], threads: [] },
                  },
                },
              ]
            : [200, {}],
      );
      yield* status.coordinationFrom(() =>
        Effect.succeed({
          enabled: false,
          policy: "coordinate",
          claudeHooks: false,
          logPath: "/tmp/test-coordination",
          sessions: [],
          overlaps: [],
          findings: [],
          contexts: [],
          candidates: [],
        }),
      );
      const result = yield* work.createTask({
        workspace: "acme",
        projectId: "pay",
        title: "Same title",
      });
      assert.strictEqual(result.createdTask.id, "mine");
      assert.deepStrictEqual(
        result.workspaces[0]?.projects[0]?.work.tasks.map((task) => task.id),
        ["other", "mine"],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("sends a task's place in the tree to the Hub as it was given", () =>
  Effect.gen(function* () {
    const created = {
      id: "t2",
      title: "Routes",
      status: "open",
      createdBy: "ana@acme.test",
      createdAt: "now",
      updatedAt: "now",
      parent: "t1",
    };
    const { work, status, calls } = yield* reporting([], (path) =>
      path === "/v1/workspaces/acme/projects/pay/tasks"
        ? [201, created]
        : path === "/v1/workspaces/acme/work"
          ? [200, { projects: { pay: { areas: [], tasks: [created], threads: [] } } }]
          : [200, created],
    );
    yield* status.coordinationFrom(() =>
      Effect.succeed({
        enabled: false,
        policy: "coordinate",
        claudeHooks: false,
        logPath: "/tmp/test-coordination",
        sessions: [],
        overlaps: [],
        findings: [],
        contexts: [],
        candidates: [],
      }),
    );
    yield* work.createTask({
      workspace: "acme",
      projectId: "pay",
      title: "Routes",
      parent: "t1",
      kind: "task",
      executable: true,
      position: 1,
      description: "- Add the route",
      source: { system: "openspec", ref: "add-x#1.1" },
    });
    yield* work.updateTask({
      workspace: "acme",
      projectId: "pay",
      taskId: "t2",
      parent: "",
      unsettled: false,
      source: null,
    });
    const bodies = calls()
      .filter((call) => call.url?.startsWith("/v1/workspaces/acme/projects/pay/tasks") === true)
      .map((call) => [call.method, JSON.parse(call.body)]);
    assert.deepStrictEqual(bodies, [
      [
        "POST",
        {
          title: "Routes",
          parent: "t1",
          kind: "task",
          executable: true,
          position: 1,
          description: "- Add the route",
          source: { system: "openspec", ref: "add-x#1.1" },
        },
      ],
      ["PATCH", { parent: "", unsettled: false, source: null }],
    ]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("puts a Peer thread on a task through a peer run, and moves or ends that run", () =>
  Effect.gen(function* () {
    const { work, status, state } = yield* reporting([], hubAnswers);
    yield* status.coordinationFrom(() =>
      Effect.succeed({
        enabled: false,
        policy: "coordinate",
        claudeHooks: false,
        logPath: "/tmp/test-coordination",
        sessions: [],
        overlaps: [],
        findings: [],
        contexts: [],
        candidates: [],
      }),
    );
    const place = { workspace: "acme", projectId: "pay", thread: "peer:thread-2" };
    yield* work.assignThread({ ...place, taskId: "krk-1", requestId: "thread-start:thread-2" });
    // A retried start finds the run it made; the work view puts the thread on its task.
    const placed = yield* work.assignThread({
      ...place,
      taskId: "krk-1",
      requestId: "thread-start:thread-2",
    });
    const runs = () =>
      Object.values(state.current().persisted.runs ?? {}).filter(
        (run) => run.thread === "peer:thread-2",
      );
    assert.deepStrictEqual(
      runs().map((run) => [run.runtime, run.task, run.endedAt]),
      [["peer", "krk-1", undefined]],
    );
    assert.strictEqual(
      runTaskOf(placed.workspaces[0]?.projects[0]?.work.runs, "peer:thread-2"),
      "krk-1",
    );
    yield* work.assignThread({ ...place, taskId: "krk-2" });
    assert.deepStrictEqual(
      runs().map((run) => run.task),
      ["krk-2"],
    );
    const cleared = yield* work.assignThread({ ...place, taskId: null });
    assert.deepStrictEqual(
      runs().map((run) => run.outcome),
      ["stopped"],
    );
    assert.isUndefined(runTaskOf(cleared.workspaces[0]?.projects[0]?.work.runs, "peer:thread-2"));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "counts a task's runs as the Hub does where it counts them, else this computer's, and keeps the old field empty",
  () =>
    Effect.gen(function* () {
      const task = (id: string, runs?: { running: number; detached: number; ended: number }) => ({
        id,
        title: id,
        status: "open",
        createdBy: "ana@acme.test",
        createdAt: "2026-10-09",
        updatedAt: "2026-10-09",
        ...(runs === undefined ? {} : { runs }),
      });
      const counted: HubAnswer = (url) =>
        url === "/v1/workspaces/acme/work"
          ? [
              200,
              {
                projects: {
                  pay: {
                    areas: [],
                    tasks: [task("krk-1", { running: 2, detached: 0, ended: 5 }), task("krk-2")],
                    threads: [],
                  },
                },
              },
            ]
          : [200, {}];
      const { work, status } = yield* reporting([], counted);
      yield* status.coordinationFrom(() =>
        Effect.succeed({
          enabled: false,
          policy: "coordinate",
          claudeHooks: false,
          logPath: "/tmp/test-coordination",
          sessions: [],
          overlaps: [],
          findings: [],
          contexts: [],
          candidates: [],
        }),
      );
      yield* work.assignThread({
        workspace: "acme",
        projectId: "pay",
        thread: "peer:thread-3",
        taskId: "krk-2",
      });
      const project = (yield* status.publish).workspaces[0]?.projects[0];
      const runsOf = (id: string) => project?.work.tasks.find((t) => t.id === id)?.runs;
      // The Hub counts every computer's runs of krk-1; it counted none of krk-2, so this computer's stand in.
      assert.deepStrictEqual(runsOf("krk-1"), { running: 2, detached: 0, ended: 5 });
      assert.deepStrictEqual(runsOf("krk-2"), { running: 0, detached: 1, ended: 0 });
      // A phone app from before runs still finds the field it requires.
      assert.deepStrictEqual(project?.work.assignments, {});
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
