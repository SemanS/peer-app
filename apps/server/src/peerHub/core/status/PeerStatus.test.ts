// @effect-diagnostics nodeBuiltinImport:off - temporary jj checkouts for the readiness case.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { PeerAgentRequest, PeerHubStatus, PeerPluginId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as PeerHubClient from "../hub/PeerHubClient.ts";
import { bindPlugin, type PeerPluginEntry } from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import { coreLayer, meAnswer, seedState, signedInSeed, standInHub } from "../testkit.ts";
import * as PeerStatus from "./PeerStatus.ts";

/** Ana in acme, whose Payments project has shared capacity and one shared thread. */
const SEED = [
  '{"hubUrl":null,"email":"ana@acme.test","pendingSignIn":null,',
  '"workspaces":[{"slug":"acme","name":"Acme","role":"member","allowedDomains":[],',
  '"manifest":{"version":2,"workspace":{"slug":"acme","name":"Acme","currency":"EUR"},',
  '"member":{"email":"ana@acme.test","name":"Ana","role":"member"},"knowledge":{},',
  '"projects":[{"id":"pay","name":"Payments","role":"lead","members":[],',
  '"repositories":[],"knowledge":{"kontext":false,"company":false},"tools":[],',
  '"capacity":{"personal":"any","personalHarnesses":[]}}]},"lastSyncAt":null}],',
  '"joinable":[],"lastSyncAt":null,"sharedInstances":{"acme/pay":["peer-acme-pay-claude"]},',
  '"sharedThreads":["peer:thread-1"]}\n',
].join("");

const request = (id: string): PeerAgentRequest => ({
  id,
  project: "pay",
  task: "krk-812",
  sender: "bob@acme.test",
  recipient: "ana@acme.test",
  title: "Review the parser",
  prompt: "Please review the parser.",
  status: "pending",
  createdAt: "2026-10-08T10:00:00Z",
  updatedAt: "2026-10-08T10:00:00Z",
});

const coordination: PeerHubStatus["coordination"] = {
  enabled: true,
  policy: "coordinate",
  claudeHooks: true,
  logPath: "/tmp/coordination.jsonl",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [{ workspace: "acme", project: "pay", proposed: 2 }],
};

/** A plugin whose only contribution is a status slice. */
const slicePlugin = (id: PeerPluginId, slice: unknown): PeerPluginEntry =>
  bindPlugin({
    id,
    title: id,
    summary: "A plugin for tests.",
    defaultEnabled: true,
    layer: Layer.empty,
    make: Effect.succeed({ status: { read: Effect.succeed(slice) } }),
  });

/** Core with `plugins` started. */
const startedCore = (plugins: ReadonlyArray<PeerPluginEntry>) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(yield* seedState(SEED), { session: "phs_test", plugins }),
    );
    return yield* Effect.gen(function* () {
      const state = yield* PeerState.PeerState;
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() => Effect.succeed(coordination));
      yield* PeerPlugins.startPlugins;
      return { state, status, plugins: yield* PeerPlugins.PeerPlugins };
    }).pipe(Effect.provide(core));
  });

/** The fields plugins that existed before plugins fill. */
const legacyFields = (status: PeerHubStatus) => ({
  requests: status.requests,
  agents: status.agents,
  github: status.github,
  sharedThreads: status.sharedThreads,
  candidates: status.coordination.candidates,
  sharedCapacity: status.workspaces[0]?.projects[0]?.sharedCapacity,
});

const LEGACY_IDS: ReadonlyArray<PeerPluginId> = [
  "herdr",
  "github",
  "capacity",
  "requests",
  "observe",
  "knowledge",
];

describe("the Peer status", () => {
  it.effect("keeps core's values for features that are no plugins yet", () =>
    Effect.gen(function* () {
      const { status } = yield* startedCore([]);
      const published = yield* status.publish;
      assert.deepStrictEqual(legacyFields(published), {
        // herdr, GitHub, shared capacity, team requests and observe are plugins, which this
        // registry leaves out: core knows none of them.
        requests: [],
        agents: { herdr: "not-running", list: [] },
        github: { cli: false, account: null, signIn: null, error: null },
        sharedThreads: [],
        candidates: [{ workspace: "acme", project: "pay", proposed: 2 }],
        sharedCapacity: { enabled: false, instanceIds: [] },
      });
      assert.deepStrictEqual(published.plugins, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "places each older plugin's slice while it is active, and its neutral value while not",
    () =>
      Effect.gen(function* () {
        const { status, plugins } = yield* startedCore([
          slicePlugin("herdr", { herdr: "running", list: [], postHocSkipped: 1 }),
          slicePlugin("github", { cli: true, account: "bob", signIn: null, error: null }),
          slicePlugin("capacity", { "acme/pay": { enabled: true, instanceIds: ["plugin-key"] } }),
          slicePlugin("requests", [{ workspace: "acme", request: request("two") }]),
          // A slice of another shape reads as the neutral value.
          slicePlugin("observe", ["peer:thread-2", 3]),
          slicePlugin("knowledge", [{ workspace: "acme", project: "pay", proposed: 5 }]),
        ]);
        assert.deepStrictEqual(legacyFields(yield* status.publish), {
          requests: [{ workspace: "acme", request: request("two") }],
          agents: { herdr: "running", list: [], postHocSkipped: 1 },
          github: { cli: true, account: "bob", signIn: null, error: null },
          sharedThreads: [],
          candidates: [{ workspace: "acme", project: "pay", proposed: 5 }],
          sharedCapacity: { enabled: true, instanceIds: ["plugin-key"] },
        });

        for (const id of LEGACY_IDS) yield* plugins.setPlugin({ id, enabled: false });
        const off = yield* status.publish;
        assert.deepStrictEqual(legacyFields(off), {
          requests: [],
          agents: { herdr: "not-running", list: [] },
          github: { cli: false, account: null, signIn: null, error: null },
          sharedThreads: [],
          candidates: [],
          sharedCapacity: { enabled: false, instanceIds: [] },
        });
        assert.deepStrictEqual(
          off.plugins?.map((plugin) => [plugin.id, plugin.active, plugin.reason]),
          LEGACY_IDS.map((id) => [id, false, "off"]),
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("carries what the Hub says of itself while signed in to it", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({
        current: () => [
          200,
          meAnswer(
            { requests: 1 },
            { featuresOff: ["resources"], hub: { version: "0.8.4", commit: "a6bde95" } },
          ),
        ],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
      );
      yield* Effect.gen(function* () {
        const status = yield* PeerStatus.PeerStatus;
        const client = yield* PeerHubClient.PeerHubClient;
        yield* status.coordinationFrom(() => Effect.succeed(coordination));
        yield* PeerPlugins.startPlugins;
        // Nothing is known of a Hub until it has answered.
        assert.isFalse(Object.hasOwn(yield* status.publish, "hub"));
        yield* client.me;
        assert.deepStrictEqual((yield* status.publish).hub, {
          version: "0.8.4",
          commit: "a6bde95",
          features: { requests: 1 },
          featuresOff: ["resources"],
        });
        // It is the session's: signed out, the status says nothing of the Hub's build or features.
        yield* client.signOut;
        assert.isFalse(Object.hasOwn(yield* status.publish, "hub"));
      }).pipe(Effect.provide(core));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("gives a later plugin a field of its own, omitted while it is inactive", () =>
    Effect.gen(function* () {
      const { status, plugins } = yield* startedCore([slicePlugin("find", { searches: 3 })]);
      const on = yield* status.publish;
      assert.deepStrictEqual(Object.getOwnPropertyDescriptor(on, "find")?.value, { searches: 3 });

      yield* plugins.setPlugin({ id: "find", enabled: false });
      assert.isFalse(Object.hasOwn(yield* status.publish, "find"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "gives a plugin that existed before plugins a second slice in the field of its own",
    () =>
      Effect.gen(function* () {
        const herdr = bindPlugin({
          id: "herdr",
          title: "herdr",
          summary: "A plugin for tests.",
          defaultEnabled: true,
          layer: Layer.empty,
          make: Effect.succeed({
            status: {
              read: Effect.succeed({ herdr: "running", list: [] }),
              field: Effect.succeed({
                bundled: true,
                runtime: {
                  source: "none",
                  state: "off",
                  agents: 0,
                  resumable: 0,
                  otherRunning: false,
                },
                integrations: [],
              }),
            },
          }),
        });
        const { status, plugins } = yield* startedCore([herdr]);
        const on = yield* status.publish;
        assert.strictEqual(on.agents.herdr, "running");
        assert.strictEqual(on.herdr?.runtime.state, "off");

        yield* plugins.setPlugin({ id: "herdr", enabled: false });
        const off = yield* status.publish;
        assert.deepStrictEqual(off.agents, { herdr: "not-running", list: [] });
        assert.isFalse(Object.hasOwn(off, "herdr"));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does not send a status equal to the last one again", () =>
    Effect.gen(function* () {
      const { state, status } = yield* startedCore([]);
      // Peer publishes once as it starts, before any client subscribes.
      yield* status.publish;
      const received = yield* Queue.unbounded<PeerHubStatus>();
      yield* status.changes.pipe(
        Stream.runForEach((next) => Queue.offer(received, next)),
        Effect.forkScoped,
      );
      assert.strictEqual((yield* Queue.take(received)).error, null);

      yield* status.publish;
      yield* status.publish;
      yield* state.updateRuntime((s) => ({ ...s, error: "The hub is unreachable." }));
      yield* status.publish;
      assert.strictEqual((yield* Queue.take(received)).error, "The hub is unreachable.");
      assert.strictEqual(yield* Queue.size(received), 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "applies a named projection and suppresses its unchanged snapshots while the default stream stays full",
    () =>
      Effect.gen(function* () {
        const view = bindPlugin({
          id: "find",
          title: "Test view",
          summary: "Projection only",
          defaultEnabled: true,
          layer: Layer.empty,
          make: Effect.succeed({
            statusViews: {
              "needs-you": (snapshot: PeerHubStatus) => ({ ...snapshot, error: null }),
            },
          }),
        });
        const { state, status } = yield* startedCore([view]);
        const full = yield* Queue.unbounded<PeerHubStatus>(),
          scoped = yield* Queue.unbounded<PeerHubStatus>();
        yield* status.subscribe().pipe(
          Stream.runForEach((next) => Queue.offer(full, next)),
          Effect.forkScoped,
        );
        yield* status.subscribe("needs-you").pipe(
          Stream.runForEach((next) => Queue.offer(scoped, next)),
          Effect.forkScoped,
        );
        yield* Queue.take(full);
        yield* Queue.take(scoped);
        yield* state.updateRuntime((s) => ({ ...s, error: "Hidden churn" }));
        yield* status.publish;
        assert.equal((yield* Queue.take(full)).error, "Hidden churn");
        yield* state.updateRuntime((s) => ({
          ...s,
          persisted: { ...s.persisted, lastSyncAt: "2026-10-09T12:00:00Z" },
        }));
        yield* status.publish;
        const next = yield* Queue.take(scoped);
        assert.equal(next.error, null);
        assert.equal(next.lastSyncAt, "2026-10-09T12:00:00Z");
        assert.equal(yield* Queue.size(scoped), 0);
        assert.equal((yield* Queue.take(full)).error, "Hidden churn");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reads a colocated jj checkout as ready and one without Git as unsupported, never missing",
    () =>
      Effect.gen(function* () {
        const dir = NodeFS.realpathSync(
          NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-status-jj-")),
        );
        const colocated = NodePath.join(dir, "app");
        const plain = NodePath.join(dir, "docs");
        NodeFS.mkdirSync(colocated);
        NodeFS.mkdirSync(plain);
        NodeChildProcess.execFileSync("jj", ["git", "init", "--colocate", "--quiet"], {
          cwd: colocated,
          stdio: "ignore",
        });
        NodeChildProcess.execFileSync("jj", ["git", "init", "--no-colocate", "--quiet"], {
          cwd: plain,
          stdio: "ignore",
        });
        const repo = (id: string) =>
          `{"id":"${id}","url":"git@github.com:acme/${id}.git","branch":"main"}`;
        const seed = SEED.replace(
          '"repositories":[]',
          `"repositories":[${repo("app")},${repo("docs")}]`,
        ).replace(
          '"sharedThreads"',
          `"localCheckouts":{"acme/pay/app":"${colocated}","acme/pay/docs":"${plain}"},"sharedThreads"`,
        );
        const core = yield* Layer.build(
          coreLayer(yield* seedState(seed), { session: "phs_test", plugins: [] }),
        );
        const published = yield* Effect.gen(function* () {
          const status = yield* PeerStatus.PeerStatus;
          yield* status.coordinationFrom(() => Effect.succeed(coordination));
          return yield* status.publish;
        }).pipe(Effect.provide(core));
        const [app, docs] = published.workspaces[0]?.projects[0]?.repositories ?? [];
        assert.strictEqual(app?.state, "ready");
        assert.strictEqual(app?.vcs, "jj");
        assert.strictEqual(docs?.state, "error");
        assert.strictEqual(docs?.unsupported, true);
        assert.include(docs?.error ?? "", "colocate");
        NodeFS.rmSync(dir, { recursive: true, force: true });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
