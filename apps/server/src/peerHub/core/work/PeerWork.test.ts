import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ProjectId,
  type PeerAgentView,
  type PeerPluginId,
  type PeerWorkThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as Settings from "../../../serverSettings.ts";
import type { ReportedThread } from "../hub/hubApi.ts";
import { bindPlugin, type PeerContributions, type PeerPluginEntry } from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import { coreLayer, seedState, standInHub, type HubAnswer, type HubCall } from "../testkit.ts";
import * as PeerWork from "./PeerWork.ts";

/** Ana signed in to `hubUrl`, in acme's Payments project, her Peer thread put on KRK-1. */
const seed = (hubUrl: string) =>
  JSON.stringify({
    hubUrl,
    email: "ana@acme.test",
    pendingSignIn: null,
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: "member",
        allowedDomains: [],
        manifest: {
          version: 2,
          workspace: { slug: "acme", name: "Acme", currency: "EUR" },
          member: { email: "ana@acme.test", name: "Ana", role: "member" },
          knowledge: {},
          projects: [
            {
              id: "pay",
              name: "Payments",
              role: "lead",
              members: [],
              repositories: [{ id: "api", url: "https://github.com/acme/api.git", branch: "main" }],
              knowledge: { kontext: false, company: false },
              tools: [],
              capacity: { personal: "any", personalHarnesses: [] },
            },
          ],
        },
        lastSyncAt: null,
      },
    ],
    joinable: [],
    lastSyncAt: null,
    sharedInstances: {},
    assignments: { "peer:thread-1": { workspace: "acme", project: "pay", task: "krk-1" } },
  });

/** Her Payments checkout is T3 project `t3-pay`, where Claude Code runs thread-1 now. */
const t3 = Layer.mergeAll(
  Layer.mock(ProjectService.ProjectService)({
    getByWorkspaceRoot: (root) =>
      Effect.succeed(
        root.endsWith("/acme/pay/api")
          ? Option.some({ id: ProjectId.make("t3-pay") } as never)
          : Option.none(),
      ),
  }),
  Layer.mock(ProjectionStore.ProjectionStoreV2)({
    getShellSnapshot: () =>
      Effect.succeed({
        threads: [
          {
            id: "thread-1",
            projectId: "t3-pay",
            title: "Split payments",
            providerInstanceId: "claude-1",
            activeProviderThreadId: "provider-1",
            branch: "feat/split",
            status: "running",
            activityRunStatus: "running",
            pendingRuntimeRequest: null,
            settledAt: null,
          },
        ],
      } as never),
    getThreadRecords: () =>
      Effect.succeed({
        providerThreads: [
          {
            id: "provider-1",
            driver: "claudeAgent",
            status: "active",
            providerSessionId: "session-1",
            nativeThreadRef: { nativeId: "native-1" },
          },
        ],
        providerSessions: [{ id: "session-1", status: "running" }],
      } as never),
  }),
  Layer.mock(Settings.ServerSettingsService)({
    getSettings: Effect.succeed({
      providerInstances: { "claude-1": { driver: "claudeAgent" } },
    } as never),
  }),
);

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

/** What a stand-in Hub answers: the work and the inbox, and it takes any report. */
const hubAnswers: HubAnswer = (url) =>
  url === "/v1/workspaces/acme/work"
    ? [200, { projects: { pay: { areas: [], tasks: [], threads: [dormant] } } }]
    : url === "/v1/workspaces/acme/requests"
      ? [200, { requests: [] }]
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
const reporting = (plugins: ReadonlyArray<PeerPluginEntry>) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: hubAnswers });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(seed(hub.url)), { session: "phs_test", plugins, t3 }),
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
        plugins: yield* PeerPlugins.PeerPlugins,
        state,
        report: () => reported(hub.calls),
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

describe("the work report", () => {
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
        yield* work.assignment("peer:thread-1"),
        Option.some({ workspace: "acme", project: "pay", task: "krk-1" }),
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
