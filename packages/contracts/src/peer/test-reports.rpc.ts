/**
 * The test-reports plugin's WebSocket RPCs: read a task's reports, file or remove the person's own,
 * and give an unverified item an owner. Agents file through `peer tests`, not through here.
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
  PeerTestReport,
  PeerTestsFileInput,
  PeerTestsFileResult,
  PeerTestsPlace,
  PeerTestsSetOwnerInput,
  PeerTestsSetOwnerResult,
} from "./test-reports.ts";

export const PEER_TEST_REPORTS_METHODS = {
  peerTestsList: "peer.testReports.list",
  peerTestsFile: "peer.testReports.file",
  peerTestsRemove: "peer.testReports.remove",
  peerTestsSetOwner: "peer.testReports.setOwner",
} as const;

const methods = PEER_TEST_REPORTS_METHODS;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);

export const TestReportsRpcGroup = RpcGroup.make(
  Rpc.make(methods.peerTestsList, {
    payload: PeerTestsPlace,
    success: Schema.Array(PeerTestReport),
    error,
  }),
  Rpc.make(methods.peerTestsFile, {
    payload: PeerTestsFileInput,
    success: PeerTestsFileResult,
    error,
  }),
  Rpc.make(methods.peerTestsRemove, {
    payload: PeerTestsPlace,
    success: Schema.Struct({ removed: Schema.Boolean }),
    error,
  }),
  Rpc.make(methods.peerTestsSetOwner, {
    payload: PeerTestsSetOwnerInput,
    success: PeerTestsSetOwnerResult,
    error,
  }),
);

/** Reading is orchestration-read; reports and their owners are shared work, so changing them is operating. */
export const TestReportsRpcScopes = {
  [methods.peerTestsList]: AuthOrchestrationReadScope,
  [methods.peerTestsFile]: AuthOrchestrationOperateScope,
  [methods.peerTestsRemove]: AuthOrchestrationOperateScope,
  [methods.peerTestsSetOwner]: AuthOrchestrationOperateScope,
} as const satisfies Record<
  RpcGroup.Rpcs<typeof TestReportsRpcGroup>["_tag"],
  AuthEnvironmentScope
>;
