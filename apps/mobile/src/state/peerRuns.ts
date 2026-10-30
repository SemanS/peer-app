import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

/**
 * Agent runs (`peerHub.runs`, `endRun`). Kept here until client-runtime's `peer/runs.ts` exports
 * the atoms itself; the phone does not continue runs in this phase, so it has no Continue.
 */
export const peerRuns = {
  // Always fresh: a run's state changes on another computer between two looks at the task.
  list: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:peer-hub:runs",
    tag: WS_METHODS.peerHubRuns,
    staleTimeMs: 0,
    idleTtlMs: 0,
  }),
  end: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:peer-hub:end-run",
    tag: WS_METHODS.peerHubEndRun,
  }),
};
