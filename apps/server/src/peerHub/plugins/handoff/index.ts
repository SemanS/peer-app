import { HandoffRpcGroup, PEER_HANDOFF_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import { HandoffService, layer } from "./service.ts";
import { handoffCommand } from "./cli.ts";
import { START_LINE } from "./render.ts";
export const HandoffPlugin = bindPlugin({
  id: "handoff",
  title: "Handoff for review",
  summary: "Store a bounded review package and publish it through your GitHub CLI.",
  defaultEnabled: true,
  commandNames: ["handoff"],
  hubFeature: { id: "handoff", revision: 1 },
  layer,
  make: Effect.gen(function* () {
    const service = yield* HandoffService,
      work = yield* PeerWork.PeerWork,
      agents = yield* PeerAgents.PeerAgents,
      state = yield* PeerState.PeerState;
    return {
      commands: [handoffCommand(work, agents, service)],
      hooks: { startLine: Effect.succeed(START_LINE) },
      reviewFacts: ({ session, remainingMs }) => service.reviewFacts(session, remainingMs),
      afterReview: ({ session, remainingMs }) => service.afterReview(session, remainingMs),
      status: { read: service.snapshot },
      hubChanges: {
        changes: ["handoff.changed", "resync"],
        onPing: (ping) =>
          ping.origin === String(state.environmentId) && ping.change !== "resync"
            ? Effect.void
            : service.refresh(ping.workspace),
      },
      lifecycle: (event) =>
        event.kind === "signed-in" || event.kind === "synced" ? service.refresh() : Effect.void,
      workspaceCleanup: (event) =>
        event.kind === "left-workspace"
          ? service.snapshot.pipe(
              Effect.flatMap((s) =>
                service.cleanup([
                  ...new Set(
                    s.summaries
                      .filter((v) => v.workspace !== event.workspace)
                      .map((v) => v.workspace),
                  ),
                ]),
              ),
            )
          : service.cleanup(event.kind === "synced" ? event.workspaces.map((w) => w.slug) : []),
      turnOff: service.reset,
      rpc: {
        group: HandoffRpcGroup,
        handlers: (wrap) =>
          HandoffRpcGroup.of({
            [PEER_HANDOFF_METHODS.peerHandoffRead]: (input) =>
              wrap.effect(PEER_HANDOFF_METHODS.peerHandoffRead, service.read(input)),
            [PEER_HANDOFF_METHODS.peerHandoffHandOff]: (input) =>
              wrap.effect(PEER_HANDOFF_METHODS.peerHandoffHandOff, service.handOff(input)),
            [PEER_HANDOFF_METHODS.peerHandoffWithdraw]: (input) =>
              wrap.effect(PEER_HANDOFF_METHODS.peerHandoffWithdraw, service.withdraw(input)),
            [PEER_HANDOFF_METHODS.peerHandoffSetTarget]: (input) =>
              wrap.effect(PEER_HANDOFF_METHODS.peerHandoffSetTarget, service.setTarget(input)),
          }),
      },
      run: service.refresh(),
    } satisfies PeerContributions;
  }),
});
