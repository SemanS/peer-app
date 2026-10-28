import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as RpcSchema from "effect/rpc/RpcSchema";

import { ORCHESTRATION_V2_WS_METHODS } from "./orchestrationV2.ts";
import { PEER_RPC_SCOPES, PEER_STREAM_METHODS, PeerRpcGroup } from "./peer/rpcRegistry.ts";
import { WS_METHODS, WsRpcGroup, WsSubscribeServerConfigRpc, WsT3RpcGroup } from "./rpc.ts";

describe("subscribeServerConfig payload compatibility", () => {
  it("is accepted by a server whose schema predates the field", () => {
    const oldServerPayload = Schema.Struct({});
    const decoded = Schema.decodeExit(oldServerPayload)({ environmentThemes: true });
    expect(Exit.isSuccess(decoded)).toBe(true);
  });

  it("is carried by a server that declares it", () => {
    const decoded = Schema.decodeSync(WsSubscribeServerConfigRpc.payloadSchema)({
      environmentThemes: true,
    });
    expect(decoded).toEqual({ environmentThemes: true });
  });

  it("stays optional, so a client that never sends it still subscribes", () => {
    const decoded = Schema.decodeSync(WsSubscribeServerConfigRpc.payloadSchema)({});
    expect(decoded).toEqual({});
  });
});

describe("WebSocket RPC contracts", () => {
  it("exposes only the V2 orchestration transport surface", () => {
    const methods = [...WsRpcGroup.requests.keys()];

    expect(methods).toEqual(expect.arrayContaining(Object.values(ORCHESTRATION_V2_WS_METHODS)));
    expect(methods.filter((method) => method.startsWith("orchestrationV1."))).toEqual([]);
  });

  it("rejects server-internal commands sent to dispatchCommand", () => {
    const dispatchCommand = WsRpcGroup.requests.get(ORCHESTRATION_V2_WS_METHODS.dispatchCommand);
    if (dispatchCommand === undefined) throw new Error("dispatchCommand is not registered");
    const decode = Schema.decodeUnknownExit(dispatchCommand.payloadSchema);

    expect(
      Exit.isFailure(
        decode({
          type: "checkpoint.rollback.fail",
          commandId: "forged-rollback-failure",
          threadId: "thread-1",
          requestId: "rollback-1",
          message: "Forged failure.",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decode({
          type: "checkpoint.rollback",
          commandId: "rollback-1",
          threadId: "thread-1",
          scopeId: "scope-1",
          checkpointId: "checkpoint-1",
        }),
      ),
    ).toBe(true);
  });

  it("lets the server pick a new worktree's folder", () => {
    const createWorktree = WsRpcGroup.requests.get(WS_METHODS.vcsCreateWorktree);
    if (createWorktree === undefined) throw new Error("vcs.createWorktree is not registered");
    const decode = Schema.decodeUnknownExit(createWorktree.payloadSchema);
    const request = { cwd: "/repo", refName: "main", newRefName: "feature/x" };

    expect(Exit.isSuccess(decode({ ...request, path: null }))).toBe(true);
    expect(Exit.isFailure(decode({ ...request, path: "/repo/.git/hooks" }))).toBe(true);
  });
});

/** Every Peer method clients of any age call; the names never change. */
const PEER_METHOD_NAMES = [
  "peer.openspec.read",
  "peer.openspec.link",
  "peer.openspec.unlink",
  "peer.openspec.saveBrief",
  "peer.changes.markReviewed",
  "peer.changes.reviewDiff",
  "peer.changes.subscribe",
  "peer.jujutsu.atOp",
  "peer.jujutsu.configure",
  "peer.jujutsu.converge",
  "peer.jujutsu.follow",
  "peer.jujutsu.integrate",
  "peer.jujutsu.operations",
  "peer.jujutsu.previewUndo",
  "peer.jujutsu.undo",
  "peer.knowledge.challenges",
  "peer.knowledge.decideChallenge",
  "peer.knowledge.draftReplacement",
  "peer.knowledge.entry",
  "peer.knowledge.openChallenge",
  "peer.knowledge.related",
  "peer.mcp.clients",
  "peer.mcp.connect",
  "peer.mcp.disconnect",
  "peerForecast.subscribe",
  "peerForecast.configure",
  "peer.metrics.summary",
  "peer.metrics.days",
  "peer.metrics.configure",
  "peer.announcements.createCredential",
  "peer.announcements.credentials",
  "peer.announcements.detail",
  "peer.announcements.list",
  "peer.announcements.post",
  "peer.announcements.revokeCredential",
  "peer.announcements.setWake",
  "peer.announcements.withdraw",
  "peer.herdr.setRuntime",
  "peer.herdr.restartRuntime",
  "peer.herdr.openTerminal",
  "peer.herdr.setIntegration",
  "peer.resources.release",
  "peer.recipes.list",
  "peer.recipes.send",
  "peer.digest.get",
  "peerImpact.list",
  "peerImpact.dismiss",
  "peerImpact.reopen",
  "peerImpact.configure",
  "peer.dependencies.change",
  "peerGitHub.status",
  "peerNeedsYou.setAlerts",
  "peer.audit.list",
  "peer.handoff.read",
  "peer.handoff.handOff",
  "peer.handoff.withdraw",
  "peer.handoff.setTarget",
  "peer.toolTrust.approve",
  "peer.toolTrust.setSecret",
  "peer.toolTrust.turnOff",
  "peerHub.memberKeys",
  "peerHub.members",
  "peerHub.removalPlan",
  "peerHub.removeMember",
  "peerHub.revokeMemberKeys",
  "peerHub.setMemberRole",
  "peerHub.setMemberProjects",
  "peerHub.signOutEverywhere",
  "peerHub.withdrawInvite",
  "peerHub.acceptFounding",
  "peerHub.declineFounding",
  "peerHub.invitations",
  "peerHub.invitePreview",
  "peerHub.resendInvite",
  "peer.webhooks.list",
  "peer.webhooks.deliveries",
  "peer.webhooks.requeue",
  "peer.webhooks.test",
  "peer.slack.me",
  "peer.slack.setMine",
  "peer.slack.link",
  "peer.slack.unlink",
  "peer.slack.admin",
  "peer.slack.saveSecrets",
  "peer.slack.verify",
  "peer.slack.channels",
  "peer.slack.setChannels",
  "peer.slack.test",
  "peer.slack.unlinkMember",
  "peer.slack.disconnect",
  "peer.ownership.list",
  "peer.ownership.setTaskOwner",
  "peer.ownership.setMap",
  "peer.ownership.decide",
  "peer.ownership.withdraw",
  "peer.ownership.take",
  "peer.plans.list",
  "peer.agreements.view",
  "peer.agreements.close",
  "peer.agreements.reopen",
  "peer.settings.get",
  "peer.settings.preview",
  "peer.settings.save",
  "peer.settings.history",
  "peer.settings.historyEntry",
  "peer.settings.revert",
  "peer.settings.importYaml",
  "peer.settings.exportYaml",
  "peer.settings.proposals",
  "peer.settings.propose",
  "peer.settings.applyProposal",
  "peer.settings.declineProposal",
  "peer.settings.withdrawProposal",
  "peer.settings.secrets",
  "peer.settings.putSecret",
  "peer.settings.deleteSecret",
  "peer.settings.gateway",
  "peer.settings.gatewayTest",
  "peer.settings.gatewaySync",
  "peer.settings.githubEnable",
  "peer.settings.githubDisable",
  "peer.settings.domainRecord",
  "peer.settings.verifyDomain",
  "peer.settings.updateWorkspace",
  "peerHub.subscribe",
  "peerHub.memoryState",
  "peerHub.memoryMode",
  "peerHub.memorySetMode",
  "peerHub.memoryExecute",
  "peerHub.memorySearch",
  "peerHub.memoryRead",
  "peerHub.memoryProject",
  "peerHub.memoryChanges",
  "peerHub.memoryReceipts",
  "peerHub.memoryKeep",
  "peerHub.memoryImportKnowledge",
  "peerHub.memoryQueue",
  "peerHub.memoryRetry",
  "peerHub.memoryDiscard",
  "peerHub.startSignIn",
  "peerHub.finishSignIn",
  "peerHub.signOut",
  "peerHub.sync",
  "peerHub.createWorkspace",
  "peerHub.joinWorkspace",
  "peerHub.leaveWorkspace",
  "peerHub.findWorkspace",
  "peerHub.createTask",
  "peerHub.sendRequest",
  "peerHub.dismissRequest",
  "peerHub.withdrawRequest",
  "peerHub.updateTask",
  "peerHub.deleteTask",
  "peerHub.assignThread",
  "peerHub.focusAgent",
  "peerHub.watchAgent",
  "peerHub.promptAgent",
  "peerHub.startAgent",
  "peerHub.coordEvents",
  "peerHub.staleReads",
  "peerHub.shareThread",
  "peerHub.observeThread",
  "peerHub.readContext",
  "peerHub.contextArchive",
  "peerHub.contextVersions",
  "peerHub.contextView",
  "peerHub.readContextVersion",
  "peerHub.restoreContext",
  "peerHub.knowledgeCandidates",
  "peerHub.decideCandidate",
  "peerHub.knowledgeStatus",
  "peerHub.setupKnowledge",
  "peerHub.keepCandidate",
  "peerHub.harvestContext",
  "peerHub.improveGuidance",
  "peerHub.shareProject",
  "peerHub.unshareProject",
  "peerHub.bindCheckout",
  "peerHub.invite",
  "peerHub.openProject",
  "peerHub.connectGitHub",
  "peerHub.cancelGitHubSignIn",
  "peerHub.setCoordination",
  "peerHub.setPlugin",
  "peerHub.noteOverlap",
  "peerHub.resolveOverlap",
  "peerHub.settleOverlap",
  "peerHub.setSharedCapacity",
  "peerHub.projectUsage",
];

describe("Peer's RPCs in the WebSocket group", () => {
  it("serves every Peer method under its name, from Peer's group alone", () => {
    const peer = new Set(PeerRpcGroup.requests.keys());
    expect(peer).toEqual(new Set(PEER_METHOD_NAMES));
    expect([...WsT3RpcGroup.requests.keys()].filter((method) => peer.has(method))).toEqual([]);
    expect(new Set(WsRpcGroup.requests.keys())).toEqual(
      new Set([...WsT3RpcGroup.requests.keys(), ...peer]),
    );
    expect(new Set(Object.keys(PEER_RPC_SCOPES))).toEqual(peer);
    const methods: ReadonlyArray<string> = Object.values(WS_METHODS);
    expect(PEER_METHOD_NAMES.filter((method) => !methods.includes(method))).toEqual([]);
  });

  it("names exactly Peer's streaming methods as such", () => {
    const streams = [...PeerRpcGroup.requests.values()]
      .filter((rpc) => RpcSchema.isStreamSchema(rpc.successSchema))
      .map((rpc) => rpc._tag);
    expect(new Set(PEER_STREAM_METHODS)).toEqual(new Set(streams));
  });
});
