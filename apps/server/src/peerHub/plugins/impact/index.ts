import { impactTools, impactRpc, impactCommand } from "./client/transport.ts";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import { PeerState } from "../../core/state/PeerState.ts";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { Impact, layer, forcedOff } from "./Impact.ts";
import { tell, resetTold } from "./tell.ts";
export const ImpactPlugin = bindPlugin({
  id: "impact",
  title: "Impact overlaps",
  summary: "Advice about changed interfaces other works use; code stays on its computer.",
  defaultEnabled: true,
  forcedOff: () => (forcedOff ? "PEER_IMPACT=off" : undefined),
  commandNames: ["impact"],
  layer,
  make: Effect.gen(function* () {
    const service = yield* Impact,
      state = yield* PeerState,
      published = yield* PeerStatus,
      agents = yield* PeerAgents;
    return {
      commands: [impactCommand(service, published)],
      agentTools: impactTools,
      hooks: {
        sessionStart: (ctx) =>
          Effect.gen(function* () {
            if (ctx.source === "compact") resetTold(ctx.session);
            return tell(
              ctx.session,
              { records: [], provided: [] },
              service.root(ctx.session.root)?.state ?? "missing",
              yield* Clock.currentTimeMillis,
              ctx.waking ?? false,
            );
          }),
        postTool: (ctx) => service.observe(ctx.session).pipe(Effect.as(null)),
        stop: (ctx) => service.observe(ctx.session),
        notices: [
          {
            wakes: false,
            read: (ctx) =>
              Effect.gen(function* () {
                const text = tell(
                  ctx.session,
                  service.view(ctx.session.workspace),
                  service.root(ctx.session.root)?.state ?? "missing",
                  yield* Clock.currentTimeMillis,
                  ctx.waking ?? false,
                );
                if (text)
                  yield* agents.log("impact.told", { session: ctx.session.id, chars: text.length });
                return text;
              }),
          },
        ],
      },
      hubChanges: {
        changes: ["impact", "resync", "coord"],
        ownEcho: true,
        onPing: (ping) => service.readSoon(ping.workspace),
      },
      status: { read: service.status },
      turnOff: service.clear,
      run: service.run(published.publish.pipe(Effect.ignore)),
      taskWorktreeCreated: service.created,
      lifecycle: (event) =>
        event.kind === "signed-in" || event.kind === "synced"
          ? Effect.gen(function* () {
              for (const w of state.current().persisted.workspaces) yield* service.readSoon(w.slug);
            })
          : Effect.void,
      workspaceCleanup: (event) =>
        event.kind === "signing-out"
          ? service.forget()
          : event.kind === "left-workspace"
            ? service.forget(event.workspace)
            : Effect.void,
      rpc: impactRpc(service, published),
    } satisfies PeerContributions;
  }),
});
