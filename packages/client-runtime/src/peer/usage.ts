import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/** A workspace's usage page, read on demand; numbers only change when a computer reports. */
export function createPeerUsageAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerUsageOverview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "peer:usage:overview",
      tag: WS_METHODS.peerUsageOverview,
      staleTimeMs: 30000,
    }),
    // Always fresh: the person may have changed it on another computer.
    peerUsageSharing: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "peer:usage:sharing",
      tag: WS_METHODS.peerUsageSharing,
      staleTimeMs: 0,
    }),
    peerUsageSetSharing: createEnvironmentRpcCommand(runtime, {
      label: "peer:usage:set-sharing",
      tag: WS_METHODS.peerUsageSetSharing,
    }),
  };
}
