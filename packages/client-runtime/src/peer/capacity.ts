import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/** Using a project's shared capacity on this environment, and what it has spent. */
export function createPeerCapacityAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerHubProjectUsage: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer-hub:project-usage",
      tag: WS_METHODS.peerHubProjectUsage,
      staleTimeMs: 30_000,
    }),
    peerHubSetSharedCapacity: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-hub:shared-capacity",
      tag: WS_METHODS.peerHubSetSharedCapacity,
    }),
  };
}
