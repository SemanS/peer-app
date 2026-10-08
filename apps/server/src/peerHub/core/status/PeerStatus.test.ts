import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { PeerAgentRequest, PeerHubStatus, PeerPluginId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { bindPlugin, type PeerPluginEntry } from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import { coreLayer, seedState } from "../testkit.ts";
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

const agent = {
  id: "herdr:t1",
  paneId: "p1",
  title: "Split payments",
  status: "working",
} as const;

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

/** Core with `plugins` started, its runtime holding a request and GitHub signed in. */
const startedCore = (plugins: ReadonlyArray<PeerPluginEntry>) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(yield* seedState(SEED), { session: "phs_test", plugins }),
    );
    return yield* Effect.gen(function* () {
      const state = yield* PeerState.PeerState;
      const status = yield* PeerStatus.PeerStatus;
      yield* status.setFacadeParts(() =>
        Effect.succeed({ agents: { herdr: "running", list: [agent] }, coordination }),
      );
      yield* state.updateRuntime((s) => ({
        ...s,
        requests: new Map([["acme", [request("one")]]]),
        github: { cli: "/usr/local/bin/gh", account: "ana", signIn: null, error: null },
      }));
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
        requests: [{ workspace: "acme", request: request("one") }],
        agents: { herdr: "running", list: [agent] },
        github: { cli: true, account: "ana", signIn: null, error: null },
        sharedThreads: ["peer:thread-1"],
        candidates: [{ workspace: "acme", project: "pay", proposed: 2 }],
        sharedCapacity: { enabled: true, instanceIds: ["peer-acme-pay-claude"] },
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

  it.effect("gives a later plugin a field of its own, omitted while it is inactive", () =>
    Effect.gen(function* () {
      const { status, plugins } = yield* startedCore([slicePlugin("find", { searches: 3 })]);
      const on = yield* status.publish;
      assert.deepStrictEqual(Object.getOwnPropertyDescriptor(on, "find")?.value, { searches: 3 });

      yield* plugins.setPlugin({ id: "find", enabled: false });
      assert.isFalse(Object.hasOwn(yield* status.publish, "find"));
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
});
