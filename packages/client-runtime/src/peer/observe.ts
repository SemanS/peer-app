import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

/** Sharing a thread of this computer with the team, and watching a colleague's live. */
export function createPeerObserveAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerHubShareThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:share-thread",
      tag: WS_METHODS.peerHubShareThread,
    }),
    /** A colleague's shared thread as it happens, relayed by the hub while you watch. */
    peerHubObserveThread: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:peer-hub:observe-thread",
      tag: WS_METHODS.peerHubObserveThread,
    }),
  };
}
