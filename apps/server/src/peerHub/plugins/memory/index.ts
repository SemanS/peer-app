/**
 * The memory plugin: Peer Memory, a project's durable shared findings, contexts and decisions,
 * which the Hub's `memory` feature keeps. It is frozen during the coordination pilot, so a normal
 * build excludes it (`PEER_MEMORY_AVAILABLE`), and a build that includes it lists it as off until
 * the environment's owner turns it on.
 *
 * Agents reach memory only by asking for it, with `peer memory`, `peer remember` and its MCP tools;
 * it adds nothing to their hooks and never takes their working context over, whatever a project's
 * memory mode. People read and write it through its RPCs. Its local queue, projections and
 * checkpoints stay on this computer whether it is on or off.
 *
 * @module peerHub/plugins/memory
 */
import { PEER_MEMORY_AVAILABLE, PEER_MEMORY_PLUGIN } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import { memoryCommands } from "./commands.ts";
import { memoryToolkit } from "./mcp/registration.ts";
import * as MemoryCli from "./MemoryCli.ts";
import * as MemoryRuntime from "./MemoryRuntime.ts";
import * as MemoryService from "./MemoryService.ts";
import * as MemoryTransport from "./MemoryTransport.ts";
import { memoryRpc } from "./rpc.ts";
import { makeBackground } from "./run.ts";

/** Memory's services, on the signed-in identity and core. */
const layer = MemoryRuntime.layer.pipe(
  Layer.provideMerge(MemoryCli.layer),
  Layer.provideMerge(MemoryService.layer),
  Layer.provideMerge(MemoryTransport.layer),
  Layer.provideMerge(MemoryRuntime.authLayer),
);

/** The plugin, included in the build or not; tests build both without touching the constant. */
export const makeMemoryPlugin = (options: { readonly available: boolean }) =>
  bindPlugin({
    ...PEER_MEMORY_PLUGIN,
    defaultEnabled: false,
    available: options.available,
    hubFeature: { id: "memory", revision: 1 },
    // A Hub may be built without memory on purpose, however new it is.
    unserved: "this Peer Hub was built without Memory",
    layer,
    make: Effect.gen(function* () {
      const memory = yield* MemoryService.MemoryService;
      const auth = yield* MemoryTransport.MemoryAuth;
      const runtime = yield* MemoryRuntime.MemoryRuntime;
      const plugins = yield* PeerPlugins.PeerPlugins;
      const background = yield* makeBackground;
      return {
        commands: memoryCommands({
          cli: yield* MemoryCli.MemoryCli,
          sync: (yield* PeerAgents.PeerAgents).sync,
          environmentId: (yield* PeerState.PeerState).environmentId,
        }),
        run: background.run,
        hubChanges: background.hubChanges,
        turnOff: background.turnOff,
        // The app-run runtimes come first: the runtime slot's observations fit the Hub's bound after.
        reportSessions: (workspace, reported) =>
          Effect.sync(() => [
            ...new Map(
              [...runtime.reported(workspace), ...reported].map((session) => [session.id, session]),
            ).values(),
          ]),
        rpc: memoryRpc(memory, auth),
        mcp: memoryToolkit({ runtime, memory, plugins }),
      } satisfies PeerContributions;
    }),
  });

export const MemoryPlugin = makeMemoryPlugin({ available: PEER_MEMORY_AVAILABLE });
