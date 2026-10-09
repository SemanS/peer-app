import { describe, expect, it } from "@effect/vitest";
import {
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  WS_METHODS,
} from "@t3tools/contracts";
import { isPlainCliCall } from "../../core/coordination/edits.ts";
import { requiredScopeForRpcMethod } from "../../../auth/RpcAuthorization.ts";
describe("announcement transport authorization", () => {
  it("lets the shell exemption recognize the complete announcement command", () => {
    expect(isPlainCliCall("peer announcements ack a1b2c3", "peer")).toBe(true);
  });
  it("uses the central scope guard for every read, mutation and one-time credential creation", () => {
    for (const method of [
      WS_METHODS.peerAnnouncementsList,
      WS_METHODS.peerAnnouncementsDetail,
      WS_METHODS.peerAnnouncementsCredentials,
    ])
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationReadScope);
    for (const method of [
      WS_METHODS.peerAnnouncementsPost,
      WS_METHODS.peerAnnouncementsWithdraw,
      WS_METHODS.peerAnnouncementsRevokeCredential,
      WS_METHODS.peerAnnouncementsSetWake,
    ])
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationOperateScope);
    expect(requiredScopeForRpcMethod(WS_METHODS.peerAnnouncementsCreateCredential)).toBe(
      AuthAccessWriteScope,
    );
  });
});
