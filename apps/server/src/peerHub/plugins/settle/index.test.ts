import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthOrchestrationOperateScope,
  PEER_SETTLE_METHODS,
  type PeerHubError,
  type PeerHubStatus,
  type PeerSettleSetResumeInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { requiredScopeForRpcMethod } from "../../../auth/RpcAuthorization.ts";
import { coreLayer, seedState } from "../../core/testkit.ts";
import { PeerPlugins, startPlugins } from "../../core/plugins/PeerPlugins.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { SettlePlugin } from "./index.ts";

const coordination: PeerHubStatus["coordination"] = {
  enabled: true,
  policy: "coordinate",
  claudeHooks: false,
  logPath: "",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

describe("the settle plugin's status and setting", () => {
  it.effect(
    "reports the setting, keeps the person's choice across a restart, and hides while off",
    () =>
      Effect.gen(function* () {
        const base = yield* seedState();
        const start = Effect.gen(function* () {
          yield* (yield* PeerStatus).coordinationFrom(() => Effect.succeed(coordination));
          yield* startPlugins;
        });
        const core = yield* Layer.build(coreLayer(base, { plugins: [SettlePlugin] }));
        yield* Effect.gen(function* () {
          const plugins = yield* PeerPlugins,
            status = yield* PeerStatus;
          yield* start;
          expect((yield* status.publish).settle).toEqual({ resume: true, attempts: [] });
          const contribution = (yield* plugins.active).find((p) => p.id === "settle")!;
          const handlers = contribution.contributions.rpc!.handlers({
            effect: (_method, effect) => effect,
            stream: (_method, stream) => stream,
          }) as Record<
            string,
            (input: PeerSettleSetResumeInput) => Effect.Effect<PeerHubStatus, PeerHubError>
          >;
          const off = yield* handlers[PEER_SETTLE_METHODS.peerSettleSetResume]!({ enabled: false });
          expect(off.settle?.resume).toBe(false);
          yield* plugins.setPlugin({ id: "settle", enabled: false });
          expect((yield* status.publish).settle).toBeUndefined();
          yield* plugins.setPlugin({ id: "settle", enabled: true });
        }).pipe(Effect.provide(core));
        const restarted = yield* Layer.build(coreLayer(base, { plugins: [SettlePlugin] }));
        yield* Effect.gen(function* () {
          yield* start;
          expect((yield* (yield* PeerStatus).publish).settle?.resume).toBe(false);
        }).pipe(Effect.provide(restarted));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it("needs the scope that lets this environment run agents", () => {
    expect(requiredScopeForRpcMethod(PEER_SETTLE_METHODS.peerSettleSetResume)).toBe(
      AuthOrchestrationOperateScope,
    );
  });
});
