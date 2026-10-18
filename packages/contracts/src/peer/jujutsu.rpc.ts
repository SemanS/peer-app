import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  AtOpRows,
  JujutsuConvergeInput,
  JujutsuConvergeResult,
  JujutsuFollowInput,
  JujutsuFollowResult,
  JujutsuIntegrateInput,
  JujutsuIntegrateResult,
  JujutsuOperationInput,
  JujutsuOperations,
  JujutsuPlace,
  JujutsuSettings,
  JujutsuState,
  UndoPreview,
  UndoResult,
} from "./jujutsu.ts";

export const PEER_JUJUTSU_METHODS = {
  peerJujutsuOperations: "peer.jujutsu.operations",
  peerJujutsuPreviewUndo: "peer.jujutsu.previewUndo",
  peerJujutsuUndo: "peer.jujutsu.undo",
  peerJujutsuAtOp: "peer.jujutsu.atOp",
  peerJujutsuFollow: "peer.jujutsu.follow",
  peerJujutsuIntegrate: "peer.jujutsu.integrate",
  peerJujutsuConverge: "peer.jujutsu.converge",
  peerJujutsuConfigure: "peer.jujutsu.configure",
} as const;

const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);

/**
 * No `peer` command or MCP tool reaches these: undo and the moves are a person's, through the app
 * on the environment that holds the repository.
 */
export const JujutsuRpcGroup = RpcGroup.make(
  Rpc.make(PEER_JUJUTSU_METHODS.peerJujutsuOperations, {
    payload: JujutsuPlace,
    success: JujutsuOperations,
    error,
  }),
  Rpc.make(PEER_JUJUTSU_METHODS.peerJujutsuPreviewUndo, {
    payload: JujutsuOperationInput,
    success: UndoPreview,
    error,
  }),
  Rpc.make(PEER_JUJUTSU_METHODS.peerJujutsuUndo, {
    payload: JujutsuOperationInput,
    success: UndoResult,
    error,
  }),
  Rpc.make(PEER_JUJUTSU_METHODS.peerJujutsuAtOp, {
    payload: JujutsuOperationInput,
    success: AtOpRows,
    error,
  }),
  Rpc.make(PEER_JUJUTSU_METHODS.peerJujutsuFollow, {
    payload: JujutsuFollowInput,
    success: JujutsuFollowResult,
    error,
  }),
  Rpc.make(PEER_JUJUTSU_METHODS.peerJujutsuIntegrate, {
    payload: JujutsuIntegrateInput,
    success: JujutsuIntegrateResult,
    error,
  }),
  Rpc.make(PEER_JUJUTSU_METHODS.peerJujutsuConverge, {
    payload: JujutsuConvergeInput,
    success: JujutsuConvergeResult,
    error,
  }),
  /** Protection on or off for this computer's agent workspaces. */
  Rpc.make(PEER_JUJUTSU_METHODS.peerJujutsuConfigure, {
    payload: JujutsuSettings,
    success: JujutsuState,
    error,
  }),
);

export const JujutsuRpcScopes = {
  [PEER_JUJUTSU_METHODS.peerJujutsuOperations]: AuthOrchestrationReadScope,
  [PEER_JUJUTSU_METHODS.peerJujutsuPreviewUndo]: AuthOrchestrationReadScope,
  [PEER_JUJUTSU_METHODS.peerJujutsuUndo]: AuthOrchestrationOperateScope,
  [PEER_JUJUTSU_METHODS.peerJujutsuAtOp]: AuthOrchestrationReadScope,
  [PEER_JUJUTSU_METHODS.peerJujutsuFollow]: AuthOrchestrationOperateScope,
  [PEER_JUJUTSU_METHODS.peerJujutsuIntegrate]: AuthOrchestrationOperateScope,
  [PEER_JUJUTSU_METHODS.peerJujutsuConverge]: AuthOrchestrationOperateScope,
  [PEER_JUJUTSU_METHODS.peerJujutsuConfigure]: AuthAccessWriteScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof JujutsuRpcGroup>["_tag"], AuthEnvironmentScope>;
