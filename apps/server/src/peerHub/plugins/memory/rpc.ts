/**
 * Memory's WebSocket RPCs: what people read and write of their projects' memory in Peer, served by
 * `MemoryService` under the names they had before plugins. Core refuses them while the plugin is
 * inactive.
 *
 * @module peerHub/plugins/memory/rpc
 */
import { MemoryRpcGroup, PEER_MEMORY_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { PeerRpcContribution } from "../../core/plugin.ts";
import { hubFailure } from "./MemoryRuntime.ts";
import type * as MemoryService from "./MemoryService.ts";
import { MemoryAuth, type MemoryError } from "./MemoryTransport.ts";

/** Traced as memory's methods always were. */
const TRACE = { "rpc.aggregate": "peerHub.memory" } as const;

export const memoryRpc = (
  memory: MemoryService.MemoryService["Service"],
  auth: MemoryAuth["Service"],
): PeerRpcContribution => ({
  group: MemoryRpcGroup,
  handlers: (wrap) => {
    const methods = PEER_MEMORY_METHODS;
    /** A method's work, its failures said as Peer's. */
    const serve = <A>(method: string, effect: Effect.Effect<A, MemoryError>) =>
      wrap.effect(method, effect.pipe(Effect.mapError(hubFailure)), TRACE);
    /** Keeping and importing knowledge read the signed-in person's checkouts. */
    const signedIn = <A>(effect: Effect.Effect<A, MemoryError, MemoryAuth>) =>
      effect.pipe(Effect.provideService(MemoryAuth, auth));
    return MemoryRpcGroup.of({
      [methods.peerHubMemoryQueue]: (input) =>
        serve(methods.peerHubMemoryQueue, memory.queue(input)),
      [methods.peerHubMemoryRetry]: (input) =>
        serve(methods.peerHubMemoryRetry, memory.retry(input)),
      [methods.peerHubMemoryDiscard]: (input) =>
        serve(methods.peerHubMemoryDiscard, memory.discard(input)),
      [methods.peerHubMemoryState]: (input) =>
        serve(methods.peerHubMemoryState, memory.synchronize(input)),
      [methods.peerHubMemoryMode]: (input) => serve(methods.peerHubMemoryMode, memory.mode(input)),
      [methods.peerHubMemorySetMode]: (input) =>
        serve(methods.peerHubMemorySetMode, memory.setMode(input)),
      [methods.peerHubMemoryExecute]: (input) => {
        // A person's operation in Peer names no agent runtime as its actor.
        const {
          sessionId: _session,
          environmentId: _environment,
          runtimeGeneration: _generation,
          ...command
        } = input.command;
        return serve(methods.peerHubMemoryExecute, memory.execute({ ...input, command }));
      },
      [methods.peerHubMemorySearch]: (input) =>
        serve(methods.peerHubMemorySearch, memory.search(input)),
      [methods.peerHubMemoryRead]: (input) => serve(methods.peerHubMemoryRead, memory.read(input)),
      [methods.peerHubMemoryProject]: (input) =>
        serve(methods.peerHubMemoryProject, memory.project(input)),
      [methods.peerHubMemoryChanges]: (input) =>
        serve(methods.peerHubMemoryChanges, memory.changes(input)),
      [methods.peerHubMemoryReceipts]: (input) =>
        serve(methods.peerHubMemoryReceipts, memory.receipts(input)),
      [methods.peerHubMemoryKeep]: (input) =>
        serve(methods.peerHubMemoryKeep, signedIn(memory.keep(input))),
      [methods.peerHubMemoryImportKnowledge]: (input) =>
        serve(methods.peerHubMemoryImportKnowledge, signedIn(memory.importKnowledge(input))),
    });
  },
});
