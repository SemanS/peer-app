/**
 * The roles plugin: what an agent session is for (the Hub's `roles` feature). A review session
 * reads and checks: Peer denies its edits and landing steps from memory, refuses its `peer review`,
 * and the Hub refuses its `peer review` and `peer done` on every adapter. It is active while the
 * signed-in Hub serves that feature.
 *
 * @module peerHub/plugins/roles
 */
import { PEER_ROLES_PLUGIN } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions, type PeerToolContext } from "../../core/plugin.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as Roles from "./Roles.ts";
import { roleCommand } from "./cli.ts";
import { roleTools, rolesRpc } from "./client/transport.ts";
import { tellings } from "./tell.ts";
import { reviewRefusal } from "./text.ts";
import { judge } from "./verdicts.ts";

export const RolesPlugin = bindPlugin({
  ...PEER_ROLES_PLUGIN,
  id: "roles",
  commandNames: ["role"],
  layer: Roles.layer,
  make: Effect.gen(function* () {
    const roles = yield* Roles.Roles;
    const agents = yield* PeerAgents.PeerAgents;
    const state = yield* PeerState.PeerState;
    const stopFor = (ctx: PeerToolContext) => judge(roles.roleOf(ctx.session), ctx);
    const tell = tellings(roles, agents);
    return {
      commands: [
        roleCommand(roles, agents, (session) =>
          state.nameOf(session.workspace, state.current().persisted.email ?? ""),
        ),
      ],
      agentTools: roleTools,
      beforeReview: ({ session }) =>
        Effect.succeed(roles.roleOf(session) === "review" ? reviewRefusal : null),
      hooks: {
        sessionStart: tell.start,
        postTool: tell.postTool,
        // A review session's edit or landing step: the same deny from memory as fallback.
        preTool: {
          on: "all",
          decide: (ctx) =>
            Effect.gen(function* () {
              const stop = stopFor(ctx);
              if (stop === null) return null;
              yield* agents.log("roles.denied", { session: ctx.session.id, where: stop.where });
              return stop.verdict;
            }),
          fallback: (ctx) => stopFor(ctx)?.verdict ?? null,
        },
      },
      hubChanges: {
        changes: ["roles.changed", "coord"],
        ownEcho: true,
        onPing: (ping) => roles.readSoon(ping.workspace, ping),
      },
      lifecycle: (event) =>
        event.kind === "synced"
          ? Effect.forEach(event.workspaces, (workspace) => roles.readSoon(workspace.slug), {
              discard: true,
            })
          : Effect.void,
      workspaceCleanup: (event) =>
        event.kind === "signing-out"
          ? roles.forget()
          : event.kind === "left-workspace"
            ? roles.forget(event.workspace)
            : roles.keep(event.workspaces.map((workspace) => workspace.slug)),
      status: { read: roles.status },
      turnOff: roles.forget(),
      rpc: rolesRpc(roles),
      reviewStarter: { start: roles.startReview },
      run: roles.follow,
    } satisfies PeerContributions;
  }),
});
