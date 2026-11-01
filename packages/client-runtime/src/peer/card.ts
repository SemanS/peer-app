/**
 * The card plugin's RPC methods as atoms.
 *
 * @module peer/card
 */
import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

export function createPeerCardAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    read: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer.card.read",
      tag: WS_METHODS.peerCardRead,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    save: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.card.save",
      tag: WS_METHODS.peerCardSave,
    }),
  };
}
