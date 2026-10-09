import { PEER_TOOL_TRUST_METHODS, PeerToolTrustRpcs } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { setWorkspaceToolGate } from "../../hubPolicy.ts";
import * as Store from "./trustStore.ts";

/** Installing and stopping the plugin always pass through the same fail-closed gate. */
export const activateToolTrust = (store: Store.ToolTrustStore["Service"]) =>
  Effect.acquireRelease(
    Effect.sync(() => setWorkspaceToolGate(store.decide)),
    () => Effect.sync(() => setWorkspaceToolGate(null)),
  );
export const ToolTrustPlugin = bindPlugin({
  id: "tool-trust",
  title: "Workspace tool trust",
  summary: "Review workspace tools and choose which secrets they may use on this computer.",
  defaultEnabled: true,
  layer: Store.layer,
  make: Effect.gen(function* () {
    const store = yield* Store.ToolTrustStore;
    const state = yield* PeerState.PeerState;
    const { publish } = yield* PeerStatus.PeerStatus;
    const methods = PEER_TOOL_TRUST_METHODS;
    const changed = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        state.lock.withPermits(1),
        Effect.tap(() => publish),
      );
    return {
      status: { read: Effect.sync(store.status) },
      rpc: {
        group: PeerToolTrustRpcs,
        handlers: (wrap) =>
          PeerToolTrustRpcs.of({
            [methods.peerToolTrustApprove]: (input) =>
              wrap.effect(methods.peerToolTrustApprove, changed(store.approve(input))),
            [methods.peerToolTrustSetSecret]: (input) =>
              wrap.effect(methods.peerToolTrustSetSecret, changed(store.setSecret(input))),
            [methods.peerToolTrustTurnOff]: (input) =>
              wrap.effect(methods.peerToolTrustTurnOff, changed(store.turnOff(input))),
          }),
      },
      lifecycle: (event) =>
        store
          .forgetAbsent(
            event.kind === "signing-out"
              ? []
              : event.kind === "left-workspace"
                ? state
                    .current()
                    .persisted.workspaces.filter((w) => w.slug !== event.workspace)
                    .map((w) => w.slug)
                : undefined,
          )
          .pipe(Effect.ignore),
      run: Effect.gen(function* () {
        yield* store.forgetAbsent().pipe(Effect.ignore);
        yield* activateToolTrust(store);
        yield* publish;
        return yield* Effect.never;
      }),
      turnOff: Effect.sync(() => setWorkspaceToolGate(null)),
    } satisfies PeerContributions;
  }),
});
