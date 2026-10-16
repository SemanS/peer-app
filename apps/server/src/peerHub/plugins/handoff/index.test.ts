import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  HandoffRpcGroup,
  HandoffRpcScopes,
  PEER_HANDOFF_METHODS,
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
import { HandoffPlugin } from "./index.ts";
const wrap: PeerRpcWrap = { effect: (_, effect) => effect, stream: (_, stream) => stream };
describe("handoff plugin lifecycle", () => {
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
                  features: { handoff: 1 },
                },
              ]
            : url.endsWith("/handoffs/pay/b")
              ? [200, { packages: [] }]
              : [200, { summaries: [] }],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(paymentsSeed(hub.url)), {
          session: "s",
          plugins: [HandoffPlugin],
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
      assert.isFalse(yield* plugins.isActive("handoff"));
      yield* (yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core))).me;
      assert.isTrue(yield* plugins.isActive("handoff"));
      const contribution = (yield* plugins.built)[0]!.contributions;
      assert.strictEqual(contribution.commands?.[0]?.name, "handoff");
      assert.isUndefined(contribution.hooks);
      assert.isDefined(contribution.afterReview);
      assert.deepStrictEqual(yield* contribution.status!.read, {
        target: "comment",
        projectTargets: {},
        summaries: [],
        deliveries: [],
      });
      const client = yield* RpcTest.makeClient(HandoffRpcGroup).pipe(
        Effect.provide(
          PeerHub.rpcLayer(wrap).pipe(
            Layer.provide(
              Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
            ),
          ),
        ),
      );
      const input = { workspace: "acme", projectId: "pay", taskId: "b" };
      assert.deepStrictEqual(yield* client[PEER_HANDOFF_METHODS.peerHandoffRead](input), []);
      yield* plugins.setPlugin({ id: "handoff", enabled: false });
      assert.deepStrictEqual(yield* plugins.active, []);
      const before = hub.calls.length;
      assert.isTrue(
        Result.isFailure(
          yield* client[PEER_HANDOFF_METHODS.peerHandoffRead](input).pipe(Effect.result),
        ),
      );
      assert.strictEqual(hub.calls.length, before);
      yield* plugins.setPlugin({ id: "handoff", enabled: true });
      assert.isTrue(yield* plugins.isActive("handoff"));
      assert.strictEqual((yield* plugins.active)[0]?.contributions.commands?.[0]?.name, "handoff");
      assert.strictEqual(
        HandoffRpcScopes[PEER_HANDOFF_METHODS.peerHandoffHandOff],
        AuthOrchestrationOperateScope,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
