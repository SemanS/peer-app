/**
 * The ownership plugin: who answers for a task, an area and a path of a project, and the owner's
 * call (the Hub's `ownership` feature). It is active while the signed-in Hub serves that feature
 * and the environment does not force it off with `PEER_OWNERSHIP=off`. `Ownership` keeps what the
 * Hub last said and serves the RPC methods the apps call; what agents hear and are stopped by, and
 * the `peer owner` command, are added to `make` as they are built.
 *
 * @module peerHub/plugins/ownership
 */
import {
  OwnershipRpcGroup,
  PEER_OWNERSHIP_METHODS,
  PEER_OWNERSHIP_PLUGIN,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions, type PeerSessionView } from "../../core/plugin.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as Ownership from "./Ownership.ts";
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
    const methods = PEER_OWNERSHIP_METHODS;
    /** What the workspace calls a person, for a stop's text. */
    const named = (session: PeerSessionView) => (email: string) =>
      owned.directory(session.workspace, session.project).name(email);
    const stopFor = (ctx: Parameters<typeof judge>[2]) =>
      judge(owned.standing(ctx.session), named(ctx.session), ctx);
    const tell = tellings(owned, agents);
    return {
      // An edit or a landing step that waits for an owner's call: a deny from memory, which the
      // fallback gives as well, so the budget never changes the outcome.
      hooks: {
        sessionStart: tell.start,
        // A decision is for the agent that asked and must be read before its work lands, so it may
        // wake it and a landing step gives it; the rest is plain news.
        notices: [
          { wakes: true, landing: true, read: tell.decisions },
          { wakes: false, read: tell.news },
        ],
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
          if (standing === undefined) return null;
          return statusLine({
            session,
            project: standing.project,
            person: standing.person,
            directory: owned.directory(session.workspace, session.project),
            now: yield* Clock.currentTimeMillis,
          });
        }),
      // An accepted request makes its recipient the owner (`requests`), a first agent does (`coord`),
      // and the tasks and projects an owner map names change with `work`.
      hubChanges: {
        changes: ["ownership", "work", "coord", "requests"],
        ownEcho: true,
        onPing: (ping) => owned.readSoon(ping.workspace),
      },
      // Connecting to a workspace's events reads it again, as every listener's `resync` does.
      lifecycle: (event) =>
        event.kind === "signing-out" || event.kind === "signed-in"
          ? owned.forget()
          : event.kind === "synced"
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
      rpc: {
        group: OwnershipRpcGroup,
        handlers: (wrap) =>
          OwnershipRpcGroup.of({
            [methods.peerOwnershipList]: (input) =>
              wrap.effect(methods.peerOwnershipList, owned.list(input)),
            [methods.peerOwnershipSetTaskOwner]: (input) =>
              wrap.effect(methods.peerOwnershipSetTaskOwner, owned.setTaskOwner(input)),
            [methods.peerOwnershipSetMap]: (input) =>
              wrap.effect(methods.peerOwnershipSetMap, owned.setMap(input)),
            [methods.peerOwnershipDecide]: (input) =>
              wrap.effect(methods.peerOwnershipDecide, owned.decide(input)),
            [methods.peerOwnershipWithdraw]: (input) =>
              wrap.effect(methods.peerOwnershipWithdraw, owned.withdraw(input)),
          }),
      },
      run: owned.follow,
    } satisfies PeerContributions;
  }),
});
