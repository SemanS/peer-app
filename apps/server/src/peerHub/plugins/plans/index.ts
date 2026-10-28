import { PEER_PLANS_METHODS, PlansRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { planCommand } from "./cli.ts";
import { planTool } from "./client/tool.ts";
import { Plans, forcedOff, layer } from "./Plans.ts";
import { START_LINE } from "./text.ts";

/**
 * Plan preflight: before it edits, an agent says what it will change, may change, use and provide,
 * and Peer tells it, and the agents of the works its plan meets, where they meet. Advice only: no
 * edit is stopped, held or ordered because of a plan. The Hub's feature has the same id.
 *
 * @module peerHub/plugins/plans
 */
export const PlansPlugin = bindPlugin({
  id: "plans",
  title: "Plans",
  summary:
    "Before editing, agents say what they will change, use and provide; Peer says whose work meets theirs.",
  defaultEnabled: true,
  forcedOff: () => (forcedOff() ? "PEER_PLANS=off" : undefined),
  commandNames: ["plan"],
  // Plans run from revision 1; challenges need 2, which `plansHub` reads from the catalog itself.
  hubFeature: { id: "plans", revision: 1 },
  layer,
  make: Effect.gen(function* () {
    const plans = yield* Plans;
    const published = yield* PeerStatus;
    const agents = yield* PeerAgents;
    return {
      commands: [planCommand(plans.commands, agents.log)],
      agentTools: [planTool],
      hooks: {
        startLine: Effect.succeed(START_LINE),
        sessionStart: plans.started,
        notices: [{ wakes: false, read: plans.notice }],
        postTool: plans.planMode,
        sessionEnd: ({ session }) => plans.ended(session),
      },
      hubChanges: {
        changes: ["plans", "resync"],
        // A plan or a relation this computer's own report made concerns its sessions too.
        ownEcho: true,
        onPing: (ping) => plans.readSoon(ping.workspace),
      },
      statusBlock: plans.statusBlock,
      status: { read: plans.status },
      rpc: {
        group: PlansRpcGroup,
        handlers: (wrap) =>
          PlansRpcGroup.of({
            [PEER_PLANS_METHODS.peerPlansList]: (place) =>
              wrap.effect(
                PEER_PLANS_METHODS.peerPlansList,
                plans.list(place).pipe(Effect.tap(() => published.publish)),
              ),
          }),
      },
      turnOff: plans.turnOff,
      run: plans.run(published.publish),
      workspaceCleanup: (event) =>
        event.kind === "signing-out"
          ? plans.forget()
          : event.kind === "left-workspace"
            ? plans.forget(event.workspace)
            : Effect.void,
    } satisfies PeerContributions;
  }),
});
