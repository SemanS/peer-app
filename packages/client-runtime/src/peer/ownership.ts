/**
 * The ownership plugin's client logic, for web and the phone alike: who owns a task, an area and
 * a path, whom a review asks and which owner's calls wait on whom (`ownershipRules.ts`), and the
 * plugin's RPC methods as atoms.
 *
 * @module peer/ownership
 */
import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

export * from "./ownershipRules.ts";

/**
 * The plugin's RPC methods as atoms: the Hub's view of a workspace's ownership (the status carries
 * the last one; this reads it again, for an editor that must start from the saved owner map), and
 * the changes a person may make: name a task's owner, take one nobody owns, save the owner map,
 * decide an owner's call, take one back. The Hub refuses what the person may not do, and its answer is the result.
 */
export function createOwnershipEnvironmentAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer.ownership.list",
      tag: WS_METHODS.peerOwnershipList,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    setTaskOwner: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.ownership.set-task-owner",
      tag: WS_METHODS.peerOwnershipSetTaskOwner,
    }),
    take: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.ownership.take",
      tag: WS_METHODS.peerOwnershipTake,
    }),
    setMap: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.ownership.set-map",
      tag: WS_METHODS.peerOwnershipSetMap,
    }),
    decide: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.ownership.decide",
      tag: WS_METHODS.peerOwnershipDecide,
    }),
    withdraw: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.ownership.withdraw",
      tag: WS_METHODS.peerOwnershipWithdraw,
    }),
  };
}
