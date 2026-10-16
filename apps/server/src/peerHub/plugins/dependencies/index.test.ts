import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  DependenciesRpcGroup,
  DependenciesRpcScopes,
  PEER_DEPENDENCY_METHODS,
  AuthOrchestrationOperateScope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as RpcTest from "effect/rpc/RpcTest";
import * as PeerHub from "../../PeerHub.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import {
  coreLayer,
  coreRpcStandIns,
  paymentsSeed,
  seedState,
  standInHub,
} from "../../core/testkit.ts";
import { DependenciesPlugin } from "./index.ts";
const wrap: PeerRpcWrap = { effect: (_, effect) => effect, stream: (_, stream) => stream };
describe("dependency plugin lifecycle", () => {
  it.effect("off and older catalog refuse RPC, on restores non-waking contributions", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({
        current: (url) =>
          url === "/v1/me"
            ? [
                200,
                {
                  email: "ana@acme.test",
                  workspaces: [],
                  joinable: [],
                  features: { dependencies: 1 },
                },
              ]
            : url.endsWith("/dependencies") && url.includes("/tasks/")
              ? [200, { task: "b", dependsOn: ["a"], changed: true }]
              : [200, { projects: {} }],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(paymentsSeed(hub.url)), {
          session: "s",
          plugins: [DependenciesPlugin],
        }),
      );
      const plugins = yield* Effect.gen(function* () {
        yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() =>
          Effect.succeed({
            enabled: false,
            policy: "coordinate",
            claudeHooks: false,
            logPath: "",
            sessions: [],
            overlaps: [],
            findings: [],
            contexts: [],
            candidates: [],
          }),
        );
        yield* PeerPlugins.startPlugins;
        return yield* PeerPlugins.PeerPlugins;
      }).pipe(Effect.provide(core));
      assert.isFalse(yield* plugins.isActive("dependencies"));
      yield* (yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core))).me;
      assert.isTrue(yield* plugins.isActive("dependencies"));
      const contribution = (yield* plugins.built)[0]!.contributions;
      assert.strictEqual(contribution.commands?.[0]?.name, "depends");
      assert.strictEqual(contribution.hooks?.notices?.[0]?.wakes, false);
      const client = yield* RpcTest.makeClient(DependenciesRpcGroup).pipe(
        Effect.provide(
          PeerHub.rpcLayer(wrap).pipe(
            Layer.provide(
              Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
            ),
          ),
        ),
      );
      const input = { workspace: "acme", projectId: "pay", taskId: "b", add: ["a"] };
      assert.strictEqual(
        (yield* client[PEER_DEPENDENCY_METHODS.peerDependenciesChange](input)).kind,
        "changed",
      );
      yield* plugins.setPlugin({ id: "dependencies", enabled: false });
      assert.deepStrictEqual(yield* plugins.active, []);
      const before = hub.calls.length;
      assert.isTrue(
        Result.isFailure(
          yield* client[PEER_DEPENDENCY_METHODS.peerDependenciesChange](input).pipe(Effect.result),
        ),
      );
      assert.strictEqual(hub.calls.length, before);
      yield* plugins.setPlugin({ id: "dependencies", enabled: true });
      assert.isTrue(yield* plugins.isActive("dependencies"));
      assert.strictEqual((yield* plugins.active)[0]?.contributions.commands?.[0]?.name, "depends");
      assert.strictEqual(
        DependenciesRpcScopes[PEER_DEPENDENCY_METHODS.peerDependenciesChange],
        AuthOrchestrationOperateScope,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
