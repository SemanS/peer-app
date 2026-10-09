import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CapacityRpcGroup, type PeerHubStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as Settings from "../../../serverSettings.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  coreLayer,
  coreRpcStandIns,
  type HubAnswer,
  seedState,
  standInHub,
} from "../../core/testkit.ts";
import * as PeerHub from "../../PeerHub.ts";
import { CapacityPlugin } from "./index.ts";

const coordination: PeerHubStatus["coordination"] = {
  enabled: false,
  policy: "coordinate",
  claudeHooks: false,
  logPath: "/tmp/coordination.jsonl",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

/** A project of acme with shared capacity. */
const sharedProject = (id: string, name: string) => ({
  id,
  name,
  role: "lead",
  members: [],
  repositories: [],
  knowledge: { kontext: false, company: false },
  tools: [],
  capacity: {
    personal: "any",
    personalHarnesses: [],
    shared: {
      pool: "acme",
      gatewayUrl: "https://gateway.acme.test",
      models: [{ id: "claude-opus-4", harness: ["claude"] }],
      budget: { amount: 100, period: "month", currency: "EUR" },
      use: ["on-demand"],
    },
  },
});

/** peer-hub.json of Ana in acme, whose Payments and Operations projects have shared capacity. */
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
          projects: [sharedProject("pay", "Payments"), sharedProject("ops", "Operations")],
        },
        lastSyncAt: null,
      },
    ],
    joinable: [],
    lastSyncAt: null,
    sharedInstances: {},
  });

const credentialsOf = (url: string) =>
  /^\/v1\/workspaces\/acme\/projects\/([a-z]+)\/credentials(\?environment=ana-laptop)?$/.exec(url);

/** A Hub that issues keys for acme's projects, and revokes them unless `refuses` names one. */
const acmeHub =
  (refuses?: string): HubAnswer =>
  (url) => {
    const credentials = credentialsOf(url);
    if (credentials === null) return [200, {}];
    const [, project = "", revoking] = credentials;
    if (revoking === undefined) {
      return [
        200,
        {
          project,
          baseUrl: "https://gateway.acme.test",
          apiKey: `key-${project}`,
          keyId: `key-id-${project}`,
          models: [{ id: "claude-opus-4", harness: ["claude"] }],
        },
      ];
    }
    return project === refuses
      ? [500, { error: { code: "internal", message: "The gateway is down." } }]
      : [200, {}];
  };

/**
 * Ana's Peer with shared capacity started over provider settings that keep what is done to them,
 * and a client of its methods.
 */
const anaWithCapacity = (answer: HubAnswer) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: answer });
    const instances: Array<string> = [];
    const t3 = Layer.mergeAll(
      Layer.mock(ProjectService.ProjectService)({
        getByWorkspaceRoot: () => Effect.succeed(Option.none()),
      }),
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getShellSnapshot: () => Effect.succeed({ threads: [] } as never),
      }),
      Layer.mock(Settings.ServerSettingsService)({
        getSettings: Effect.succeed({ providerInstances: {} } as never),
        updateProviderInstance: (mutation) =>
          Effect.sync(() => {
            instances.push(`${mutation.operation} ${mutation.instanceId}`);
            return {} as never;
          }),
      }),
    );
    const core = yield* Layer.build(
      coreLayer(yield* seedState(seed(hub.url)), {
        session: "phs_test",
        plugins: [CapacityPlugin],
        t3,
      }),
    );
    const { status, plugins } = yield* Effect.gen(function* () {
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() => Effect.succeed(coordination));
      yield* PeerPlugins.startPlugins;
      return { status, plugins: yield* PeerPlugins.PeerPlugins };
    }).pipe(Effect.provide(core));
    const wrap: PeerRpcWrap = {
      effect: (_method, effect) => effect,
      stream: (_method, stream) => stream,
    };
    const client = yield* RpcTest.makeClient(CapacityRpcGroup).pipe(
      Effect.provide(
        PeerHub.rpcLayer(wrap).pipe(
          Layer.provide(
            Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
          ),
        ),
      ),
    );
    const turn = (projectId: string, enabled: boolean) =>
      client["peerHub.setSharedCapacity"]({ workspace: "acme", projectId, enabled });
    /** Each project's shared capacity, as the status shows it now. */
    const shown = Effect.map(status.publish, (now) =>
      Object.fromEntries(
        now.workspaces.flatMap((workspace) =>
          workspace.projects.map((project) => [project.project.id, project.sharedCapacity]),
        ),
      ),
    );
    return { hub, instances, plugins, turn, shown };
  });

describe("shared capacity", () => {
  it.effect(
    "turned off with two projects on, revokes both keys and removes both instances for good",
    () =>
      Effect.gen(function* () {
        const { hub, instances, plugins, turn, shown } = yield* anaWithCapacity(acmeHub());
        yield* turn("pay", true);
        yield* turn("ops", true);
        assert.deepStrictEqual(yield* shown, {
          pay: { enabled: true, instanceIds: ["peer-acme-pay-claude"] },
          ops: { enabled: true, instanceIds: ["peer-acme-ops-claude"] },
        });

        yield* plugins.setPlugin({ id: "capacity", enabled: false });
        assert.deepStrictEqual(
          hub.calls.filter((call) => call.method === "DELETE").map((call) => call.url),
          [
            "/v1/workspaces/acme/projects/pay/credentials?environment=ana-laptop",
            "/v1/workspaces/acme/projects/ops/credentials?environment=ana-laptop",
          ],
        );
        assert.deepStrictEqual(instances, [
          "upsert peer-acme-pay-claude",
          "upsert peer-acme-ops-claude",
          "remove peer-acme-pay-claude",
          "remove peer-acme-ops-claude",
        ]);
        // While off, turning a project's shared capacity on is refused, and no key is issued.
        const issued = () => hub.calls.filter((call) => call.method === "POST").length;
        const before = issued();
        const refused = yield* turn("pay", true).pipe(Effect.result);
        assert.isTrue(Result.isFailure(refused));
        if (Result.isFailure(refused)) {
          assert.strictEqual(
            refused.failure.message,
            "Shared capacity is turned off on this environment.",
          );
        }
        assert.strictEqual(issued(), before);

        yield* plugins.setPlugin({ id: "capacity", enabled: true });
        assert.deepStrictEqual(yield* shown, {
          pay: { enabled: false, instanceIds: [] },
          ops: { enabled: false, instanceIds: [] },
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("shows a revocation the Hub refused as the plugin's error", () =>
    Effect.gen(function* () {
      const { instances, plugins, turn, shown } = yield* anaWithCapacity(acmeHub("ops"));
      yield* turn("pay", true);
      yield* turn("ops", true);

      yield* plugins.setPlugin({ id: "capacity", enabled: false });
      assert.deepStrictEqual(
        (yield* plugins.states).find((plugin) => plugin.id === "capacity"),
        {
          id: "capacity",
          title: "Shared capacity",
          enabled: false,
          active: false,
          reason: "off",
          error:
            "The Hub did not revoke this environment's shared capacity keys of acme/ops (The gateway is down.).",
        },
      );
      // No instance holds a key here any more, whatever the Hub said.
      assert.deepStrictEqual(instances.slice(2), [
        "remove peer-acme-pay-claude",
        "remove peer-acme-ops-claude",
      ]);
      assert.deepStrictEqual(yield* shown, {
        pay: { enabled: false, instanceIds: [] },
        ops: { enabled: false, instanceIds: [] },
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
