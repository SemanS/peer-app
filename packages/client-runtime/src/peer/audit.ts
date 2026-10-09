import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";
export function createPeerAuditAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerAuditList: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer-audit:list",
      tag: WS_METHODS.peerAuditList,
    }),
  };
}
