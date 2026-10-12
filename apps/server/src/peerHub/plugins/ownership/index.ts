/**
 * The ownership plugin: who answers for a task, an area and a path of a project, and the owner's
 * call (the Hub's `ownership` feature). It is active while the signed-in Hub serves that feature
 * and the environment does not force it off with `PEER_OWNERSHIP=off`.
 *
 * @module peerHub/plugins/ownership
 */
import { PEER_OWNERSHIP_PLUGIN } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions, type PeerToolContext } from "../../core/plugin.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as Ownership from "./Ownership.ts";
import { ownershipRpc } from "./client/transport.ts";
import { statusLine } from "./text.ts";
import { tellings } from "./tell.ts";
import { judge } from "./verdicts.ts";

export const OwnershipPlugin = bindPlugin({
  ...PEER_OWNERSHIP_PLUGIN,
  id: "ownership",
  forcedOff: () => (process.env.PEER_OWNERSHIP === "off" ? "PEER_OWNERSHIP=off" : undefined),
  layer: Ownership.layer,
  make: Effect.gen(function* () {
    const owned = yield* Ownership.Ownership;
    const agents = yield* PeerAgents.PeerAgents;
    const stopFor = (ctx: PeerToolContext) =>
      judge(
        owned.standing(ctx.session),
        (email) => owned.directory(ctx.session.workspace, ctx.session.project).name(email),
        ctx,
      );
    const tell = tellings(owned, agents);
    return {
      hooks: {
        sessionStart: tell.start,
        // A decision is for the agent that asked and must be read before its work lands: it may
        // wake it, and a landing step gives it. The rest is plain news.
        notices: [
          { wakes: true, landing: true, read: tell.decisions },
          { wakes: false, read: tell.news },
        ],
        // An edit or a landing step that waits for an owner's call: the same deny from memory as fallback.
        preTool: {
          on: "all",
          decide: (ctx) =>
            Effect.gen(function* () {
              const stop = stopFor(ctx);
              if (stop === null) return null;
              yield* agents.log("ownership.stopped", {
                session: ctx.session.id,
                where: stop.where,
              });
              return stop.verdict;
            }),
          fallback: (ctx) => stopFor(ctx)?.verdict ?? null,
        },
      },
      statusBlock: (session) =>
        Effect.gen(function* () {
          const standing = owned.standing(session);
          const dir = owned.directory(session.workspace, session.project);
          return standing === undefined
            ? null
            : statusLine(session, standing, dir, yield* Clock.currentTimeMillis);
        }),
      // An accepted request (`requests`) or a first agent (`coord`) makes an owner; `work` names tasks.
      hubChanges: {
        changes: ["ownership", "work", "coord", "requests"],
        ownEcho: true,
        onPing: (ping) => owned.readSoon(ping.workspace),
      },
      // Connecting to a workspace's events reads it again, as every listener's `resync` does.
      lifecycle: (event) =>
        event.kind === "synced"
          ? Effect.forEach(event.workspaces, (workspace) => owned.readSoon(workspace.slug), {
              discard: true,
            })
          : Effect.void,
      workspaceCleanup: (event) =>
        event.kind === "signing-out"
          ? owned.forget()
          : event.kind === "left-workspace"
            ? owned.forget(event.workspace)
            : owned.keep(event.workspaces.map((workspace) => workspace.slug)),
      status: { read: owned.status },
      turnOff: owned.forget(),
      rpc: ownershipRpc(owned),
      run: owned.follow,
    } satisfies PeerContributions;
  }),
});
