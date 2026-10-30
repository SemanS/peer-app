/**
 * Runs are core, not a plugin, so their methods keep core's `peerHub.<name>` names.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerHubContinueRunInput,
  PeerHubContinueRunResult,
  PeerHubEndRunInput,
  PeerHubRunsInput,
  PeerHubRunsResult,
  PeerRun,
} from "./runs.ts";

export const PEER_RUNS_METHODS = {
  peerHubRuns: "peerHub.runs",
  peerHubEndRun: "peerHub.endRun",
  peerHubContinueRun: "peerHub.continueRun",
} as const;

const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);

export const RunsRpcGroup = RpcGroup.make(
  Rpc.make(PEER_RUNS_METHODS.peerHubRuns, {
    payload: PeerHubRunsInput,
    success: PeerHubRunsResult,
    error,
  }),
  /** Answers with the run as it ended. */
  Rpc.make(PEER_RUNS_METHODS.peerHubEndRun, {
    payload: PeerHubEndRunInput,
    success: PeerRun,
    error,
  }),
  Rpc.make(PEER_RUNS_METHODS.peerHubContinueRun, {
    payload: PeerHubContinueRunInput,
    success: PeerHubContinueRunResult,
    error,
  }),
);

/** Ending a run changes shared work and continuing one starts an agent here: both operate. */
export const RunsRpcScopes = {
  [PEER_RUNS_METHODS.peerHubRuns]: AuthOrchestrationReadScope,
  [PEER_RUNS_METHODS.peerHubEndRun]: AuthOrchestrationOperateScope,
  [PEER_RUNS_METHODS.peerHubContinueRun]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof RunsRpcGroup>["_tag"], AuthEnvironmentScope>;
