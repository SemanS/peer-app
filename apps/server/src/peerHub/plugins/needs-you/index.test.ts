import { emptyStatus } from "./testkit.ts";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthAccessWriteScope,
  WS_METHODS,
  type PeerHubStatus,
  type PeerHubError,
  type EnvironmentAuthorizationError,
  type PeerNeedsYouSetAlertsInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { coreLayer, seedState } from "../../core/testkit.ts";
import { PeerPlugins, startPlugins } from "../../core/plugins/PeerPlugins.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { requiredScopeForRpcMethod } from "../../../auth/RpcAuthorization.ts";
import { NeedsYouPlugin } from "./index.ts";

describe("Needs You plugin wiring", () => {
  it.effect("persists opt-in, returns its fragment and hides it while the plugin is off", () =>
    Effect.gen(function* () {
      const base = yield* seedState();
      const core = yield* Layer.build(coreLayer(base, { plugins: [NeedsYouPlugin] }));
      yield* Effect.gen(function* () {
        const plugins = yield* PeerPlugins,
          status = yield* PeerStatus;
        yield* status.coordinationFrom(() => Effect.succeed(emptyStatus().coordination));
        yield* startPlugins;
        expect((yield* status.publish).needsYou?.alerts).toEqual({
          enabled: false,
          delivery: "not-linked",
        });
        const contribution = (yield* plugins.active).find((p) => p.id === "needs-you")!;
        const handlers = contribution.contributions.rpc!.handlers({
          effect: (_method, effect) => effect,
          stream: (_method, stream) => stream,
        }) as {
          "peerNeedsYou.setAlerts": (
            input: PeerNeedsYouSetAlertsInput,
          ) => Effect.Effect<PeerHubStatus, PeerHubError | EnvironmentAuthorizationError>;
        };
        const enabled = yield* handlers[WS_METHODS.peerNeedsYouSetAlerts]({ enabled: true });
        expect(enabled.needsYou?.alerts.enabled).toBe(true);
        const scoped = yield* status.subscribe("needs-you").pipe(Stream.take(1), Stream.runCollect);
        expect(scoped[0]?.workspaceRoot).toBe("");
        yield* plugins.setPlugin({ id: "needs-you", enabled: false });
        expect((yield* status.publish).needsYou).toBeUndefined();
        expect((yield* plugins.active).some((p) => p.id === "needs-you")).toBe(false);
      }).pipe(Effect.provide(core));
      const restarted = yield* Layer.build(coreLayer(base, { plugins: [NeedsYouPlugin] }));
      yield* Effect.gen(function* () {
        const status = yield* PeerStatus;
        yield* status.coordinationFrom(() => Effect.succeed(emptyStatus().coordination));
        yield* startPlugins;
        expect((yield* status.publish).needsYou).toBeUndefined();
      }).pipe(Effect.provide(restarted));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it("requires owner permission to send workspace titles outside the computer", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.peerNeedsYouSetAlerts)).toBe(AuthAccessWriteScope);
  });
});
