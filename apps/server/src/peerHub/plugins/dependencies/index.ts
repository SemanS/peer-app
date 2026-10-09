import { DependenciesRpcGroup, PEER_DEPENDENCY_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import { Dependencies, layer } from "./service.ts";
import { dependsCli } from "./cli.ts";
export const DependenciesPlugin = bindPlugin({
  id: "dependencies",
  title: "Task dependencies",
  summary: "Record task relationships and hear changes once; work is never gated.",
  defaultEnabled: true,
  commandNames: ["depends"],
  hubFeature: { id: "dependencies", revision: 1 },
  layer,
  make: Effect.gen(function* () {
    const service = yield* Dependencies,
      work = yield* PeerWork.PeerWork,
      agents = yield* PeerAgents.PeerAgents;
    return {
      commands: [
        {
          name: "depends",
          usage: "depends [--remove] [task]...",
          summary: "record or remove dependencies; list both directions",
          run: dependsCli(service, work, agents),
        },
      ],
      hooks: {
        sessionStart: ({ session }) => service.hook(session, true),
        notices: [{ wakes: false, read: ({ session }) => service.hook(session, false) }],
      },
      commandReply: (session, command) =>
        command === "review" || command === "done"
          ? service.handoff(session)
          : Effect.succeed(null),
      status: { read: service.snapshot },
      hubChanges: {
        changes: ["dependencies", "work", "resync"],
        onPing: (ping) =>
          ping.change === "resync"
            ? service.refresh(ping.workspace)
            : service.ping(ping.workspace, ping.change),
      },
      lifecycle: () => service.refresh(),
      workspaceCleanup: (event) =>
        event.kind === "left-workspace"
          ? service.snapshot.pipe(
              Effect.flatMap((values) =>
                service.cleanup(
                  values.filter((v) => v.workspace !== event.workspace).map((v) => v.workspace),
                ),
              ),
            )
          : service.cleanup(event.kind === "synced" ? event.workspaces.map((w) => w.slug) : []),
      turnOff: service.reset,
      rpc: {
        group: DependenciesRpcGroup,
        handlers: (wrap) =>
          DependenciesRpcGroup.of({
            [PEER_DEPENDENCY_METHODS.peerDependenciesChange]: (input) =>
              wrap.effect(PEER_DEPENDENCY_METHODS.peerDependenciesChange, service.change(input), {
                "rpc.aggregate": "peerHub",
              }),
          }),
      },
      run: service.reset.pipe(Effect.andThen(service.refresh()), Effect.andThen(service.run)),
    } satisfies PeerContributions;
  }),
});
