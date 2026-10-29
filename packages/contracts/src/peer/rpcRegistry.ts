import {
  PeerContextView,
  PeerContextViewInput,
  PeerContextArchive,
  PeerContextArchiveInput,
} from "./contextView.ts";
import { PEER_OPENSPEC_METHODS, OpenSpecRpcGroup, OpenSpecRpcScopes } from "./openspec.rpc.ts";
import { PEER_DIGEST_METHODS, DigestRpcGroup, DigestRpcScopes } from "./digest.ts";
import { PEER_RECIPES_METHODS, RecipesRpcGroup, RecipesRpcScopes } from "./recipes.ts";
import { PEER_IMPACT_METHODS, PeerImpactRpcs, ImpactRpcScopes } from "./impact.ts";
import { PEER_PLANS_METHODS, PlansRpcGroup, PlansRpcScopes } from "./plans.rpc.ts";
import {
  AgreementsRpcGroup,
  AgreementsRpcScopes,
  PEER_AGREEMENTS_METHODS,
} from "./agreements.rpc.ts";
import { PEER_RESOURCES_METHODS, ResourcesRpcGroup, ResourcesRpcScopes } from "./resources.rpc.ts";
import { PeerHubSubscribeInput } from "./needs-you.ts";
import { PEER_FORECAST_METHODS, WsPeerForecastRpcGroup, ForecastRpcScopes } from "./forecast.ts";
import { PEER_NEEDS_YOU_METHODS, NeedsYouRpcGroup, NeedsYouRpcScopes } from "./needs-you.rpc.ts";
import { PEER_SETTLE_METHODS, SettleRpcGroup, SettleRpcScopes } from "./settle.rpc.ts";
import { MetricsRpcGroup, MetricsRpcScopes, PEER_METRICS_METHODS } from "./metrics.rpc.ts";
import { HandoffRpcGroup, HandoffRpcScopes, PEER_HANDOFF_METHODS } from "./handoff.rpc.ts";
import {
  DependenciesRpcGroup,
  DependenciesRpcScopes,
  PEER_DEPENDENCY_METHODS,
} from "./dependencies.rpc.ts";
import { PEER_TOOL_TRUST_METHODS, PeerToolTrustRpcs, ToolTrustRpcScopes } from "./toolTrust.rpc.ts";
import {
  PEER_ANNOUNCEMENTS_METHODS,
  AnnouncementsRpcGroup,
  AnnouncementsRpcScopes,
} from "./announcements.rpc.ts";
/**
 * Peer's WebSocket RPCs. Core's group and each plugin's group merge into `PeerRpcGroup`, which
 * `rpc.ts` merges into `WsRpcGroup`; their scopes merge into `PEER_RPC_SCOPES`, which the server's
 * authorization table spreads. A plugin whose contracts move to `peer/<id>.rpc.ts` adds its
 * methods, group and scopes here, one line each.
 *
 * Method names never change, so clients of every age keep working: moved methods keep
 * `peerHub.<name>`, new plugins use `peer.<id>.<name>`.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthAccessWriteScope,
  AuthAccessReadScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import {
  PeerHubBindCheckoutInput,
  PeerHubCreateWorkspaceInput,
  PeerHubError,
  PeerFoundWorkspace,
  PeerHubAssignThreadInput,
  PeerHubCreateTaskInput,
  PeerHubCreateTaskResult,
  PeerHubFindWorkspaceInput,
  PeerHubOverlapNoteInput,
  PeerHubResolveOverlapInput,
  PeerHubSettleOverlapInput,
  PeerHubSetCoordinationInput,
  PeerHubShareProjectInput,
  PeerHubTaskInput,
  PeerHubUpdateTaskInput,
  PeerHubFinishSignInInput,
  PeerHubInviteInput,
  PeerHubInviteResult,
  PeerHubProjectInput,
  PeerHubStartSignInInput,
  PeerHubStatus,
  PeerHubWorkspaceInput,
  PeerWorkspaceMembers,
  PeerRemovalPlan,
  PeerMemberKeys,
  PeerHubInvitePreviewInput,
  PeerHubMemberInput,
  PeerHubMemberProjectsInput,
  PeerHubMemberRoleInput,
  PeerHubMemberKeysInput,
  PeerHubJoinWorkspaceInput,
  PeerHubContextInput,
  PeerHubContextVersionInput,
  PeerContextVersion,
  PeerContextVersionText,
  PeerWorkContextText,
  PeerHubStartAgentInput,
  PeerHubStartAgentResult,
  PeerHubCoordEventsInput,
  PeerHubStaleReadsInput,
  PeerCoordEvent,
  PeerStaleReads,
  PeerHubFoundingInput,
  PeerInvitation,
  PeerInvitationList,
  PeerInvitePreview,
} from "../peerHub.ts";
import { AuditRpcGroup, AuditRpcScopes, PEER_AUDIT_METHODS } from "./audit.rpc.ts";
import { CapacityRpcGroup, CapacityRpcScopes, PEER_CAPACITY_METHODS } from "./capacity.rpc.ts";
import { GitHubRpcGroup, GitHubRpcScopes, PEER_GITHUB_METHODS } from "./github.rpc.ts";
import { ChangesRpcGroup, ChangesRpcScopes, PEER_CHANGES_METHODS } from "./changes.rpc.ts";
import { JujutsuRpcGroup, JujutsuRpcScopes, PEER_JUJUTSU_METHODS } from "./jujutsu.rpc.ts";
import { HerdrRpcGroup, HerdrRpcScopes, PEER_HERDR_METHODS } from "./herdr.rpc.ts";
import { KnowledgeRpcGroup, KnowledgeRpcScopes, PEER_KNOWLEDGE_METHODS } from "./knowledge.rpc.ts";
import { McpRpcGroup, McpRpcScopes, PEER_MCP_METHODS } from "./mcp.rpc.ts";
import { MemoryRpcGroup, MemoryRpcScopes, PEER_MEMORY_METHODS } from "./memory.rpc.ts";
import { ObserveRpcGroup, ObserveRpcScopes, PEER_OBSERVE_METHODS } from "./observe.rpc.ts";
import { PeerHubSetPluginInput } from "./plugin.ts";
import { PEER_REQUESTS_METHODS, RequestsRpcGroup, RequestsRpcScopes } from "./requests.rpc.ts";
import { OwnershipRpcGroup, OwnershipRpcScopes, PEER_OWNERSHIP_METHODS } from "./ownership.rpc.ts";
import { PEER_SETTINGS_METHODS, SettingsRpcGroup, SettingsRpcScopes } from "./settings.rpc.ts";
import { PEER_SLACK_METHODS, SlackRpcGroup, SlackRpcScopes } from "./slack.rpc.ts";
import { PEER_WEBHOOKS_METHODS, WebhooksRpcGroup, WebhooksRpcScopes } from "./webhooks.rpc.ts";
import {
  PEER_TEST_REPORTS_METHODS,
  TestReportsRpcGroup,
  TestReportsRpcScopes,
} from "./test-reports.rpc.ts";
import { PEER_ROLES_METHODS, RolesRpcGroup, RolesRpcScopes } from "./roles.rpc.ts";
import {
  AcceptanceRpcGroup,
  AcceptanceRpcScopes,
  PEER_ACCEPTANCE_METHODS,
} from "./acceptance.rpc.ts";

export * from "./changes.rpc.ts";
export * from "./jujutsu.rpc.ts";
export * from "./roles.rpc.ts";

/** Core's methods. */
export const PEER_CORE_METHODS = {
  peerHubSubscribe: "peerHub.subscribe",
  peerHubStartSignIn: "peerHub.startSignIn",
  peerHubFinishSignIn: "peerHub.finishSignIn",
  peerHubMembers: "peerHub.members",
  peerHubRemovalPlan: "peerHub.removalPlan",
  peerHubRemoveMember: "peerHub.removeMember",
  peerHubSetMemberRole: "peerHub.setMemberRole",
  peerHubSetMemberProjects: "peerHub.setMemberProjects",
  peerHubWithdrawInvite: "peerHub.withdrawInvite",
  peerHubMemberKeys: "peerHub.memberKeys",
  peerHubRevokeMemberKeys: "peerHub.revokeMemberKeys",
  peerHubSignOutEverywhere: "peerHub.signOutEverywhere",
  peerHubSignOut: "peerHub.signOut",
  peerHubSync: "peerHub.sync",
  peerHubCreateWorkspace: "peerHub.createWorkspace",
  peerHubJoinWorkspace: "peerHub.joinWorkspace",
  peerHubLeaveWorkspace: "peerHub.leaveWorkspace",
  peerHubFindWorkspace: "peerHub.findWorkspace",
  peerHubCreateTask: "peerHub.createTask",
  peerHubUpdateTask: "peerHub.updateTask",
  peerHubDeleteTask: "peerHub.deleteTask",
  peerHubAssignThread: "peerHub.assignThread",
  peerHubStartAgent: "peerHub.startAgent",
  peerHubCoordEvents: "peerHub.coordEvents",
  peerHubStaleReads: "peerHub.staleReads",
  peerHubReadContext: "peerHub.readContext",
  peerHubContextView: "peerHub.contextView",
  peerHubContextArchive: "peerHub.contextArchive",
  peerHubContextVersions: "peerHub.contextVersions",
  peerHubReadContextVersion: "peerHub.readContextVersion",
  peerHubRestoreContext: "peerHub.restoreContext",
  peerHubShareProject: "peerHub.shareProject",
  peerHubUnshareProject: "peerHub.unshareProject",
  peerHubBindCheckout: "peerHub.bindCheckout",
  peerHubInvite: "peerHub.invite",
  peerHubOpenProject: "peerHub.openProject",
  peerHubSetCoordination: "peerHub.setCoordination",
  peerHubSetPlugin: "peerHub.setPlugin",
  peerHubNoteOverlap: "peerHub.noteOverlap",
  peerHubResolveOverlap: "peerHub.resolveOverlap",
  peerHubSettleOverlap: "peerHub.settleOverlap",
  peerHubAcceptFounding: "peerHub.acceptFounding",
  peerHubDeclineFounding: "peerHub.declineFounding",
  peerHubInvitations: "peerHub.invitations",
  peerHubInvitePreview: "peerHub.invitePreview",
  peerHubResendInvite: "peerHub.resendInvite",
} as const;

const WsPeerHubSubscribeRpc = Rpc.make(PEER_CORE_METHODS.peerHubSubscribe, {
  payload: PeerHubSubscribeInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsPeerHubStartSignInRpc = Rpc.make(PEER_CORE_METHODS.peerHubStartSignIn, {
  payload: PeerHubStartSignInInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubFinishSignInRpc = Rpc.make(PEER_CORE_METHODS.peerHubFinishSignIn, {
  payload: PeerHubFinishSignInInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubSignOutRpc = Rpc.make(PEER_CORE_METHODS.peerHubSignOut, {
  payload: Schema.Struct({}),
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubSyncRpc = Rpc.make(PEER_CORE_METHODS.peerHubSync, {
  payload: Schema.Struct({}),
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubCreateWorkspaceRpc = Rpc.make(PEER_CORE_METHODS.peerHubCreateWorkspace, {
  payload: PeerHubCreateWorkspaceInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubJoinWorkspaceRpc = Rpc.make(PEER_CORE_METHODS.peerHubJoinWorkspace, {
  payload: PeerHubJoinWorkspaceInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubLeaveWorkspaceRpc = Rpc.make(PEER_CORE_METHODS.peerHubLeaveWorkspace, {
  payload: PeerHubWorkspaceInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubInviteRpc = Rpc.make(PEER_CORE_METHODS.peerHubInvite, {
  payload: PeerHubInviteInput,
  success: PeerHubInviteResult,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubOpenProjectRpc = Rpc.make(PEER_CORE_METHODS.peerHubOpenProject, {
  payload: PeerHubProjectInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubSetCoordinationRpc = Rpc.make(PEER_CORE_METHODS.peerHubSetCoordination, {
  payload: PeerHubSetCoordinationInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** An owner turns one of Peer's plugins on or off on this environment. */
const WsPeerHubSetPluginRpc = Rpc.make(PEER_CORE_METHODS.peerHubSetPlugin, {
  payload: PeerHubSetPluginInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubNoteOverlapRpc = Rpc.make(PEER_CORE_METHODS.peerHubNoteOverlap, {
  payload: PeerHubOverlapNoteInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubResolveOverlapRpc = Rpc.make(PEER_CORE_METHODS.peerHubResolveOverlap, {
  payload: PeerHubResolveOverlapInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubSettleOverlapRpc = Rpc.make(PEER_CORE_METHODS.peerHubSettleOverlap, {
  payload: PeerHubSettleOverlapInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubCreateTaskRpc = Rpc.make(PEER_CORE_METHODS.peerHubCreateTask, {
  payload: PeerHubCreateTaskInput,
  success: PeerHubCreateTaskResult,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubUpdateTaskRpc = Rpc.make(PEER_CORE_METHODS.peerHubUpdateTask, {
  payload: PeerHubUpdateTaskInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubDeleteTaskRpc = Rpc.make(PEER_CORE_METHODS.peerHubDeleteTask, {
  payload: PeerHubTaskInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubAssignThreadRpc = Rpc.make(PEER_CORE_METHODS.peerHubAssignThread, {
  payload: PeerHubAssignThreadInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubStartAgentRpc = Rpc.make(PEER_CORE_METHODS.peerHubStartAgent, {
  payload: PeerHubStartAgentInput,
  success: PeerHubStartAgentResult,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubCoordEventsRpc = Rpc.make(PEER_CORE_METHODS.peerHubCoordEvents, {
  payload: PeerHubCoordEventsInput,
  success: Schema.Array(PeerCoordEvent),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubStaleReadsRpc = Rpc.make(PEER_CORE_METHODS.peerHubStaleReads, {
  payload: PeerHubStaleReadsInput,
  success: PeerStaleReads,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** A task's shared context with its text; null when it has none yet. */
const WsPeerHubReadContextRpc = Rpc.make(PEER_CORE_METHODS.peerHubReadContext, {
  payload: PeerHubContextInput,
  success: Schema.NullOr(PeerWorkContextText),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubContextViewRpc = Rpc.make(PEER_CORE_METHODS.peerHubContextView, {
  payload: PeerContextViewInput,
  success: PeerContextView,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});
const WsPeerHubContextArchiveRpc = Rpc.make(PEER_CORE_METHODS.peerHubContextArchive, {
  payload: PeerContextArchiveInput,
  success: PeerContextArchive,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** The versions of a shared context the hub keeps, newest first. */
const WsPeerHubContextVersionsRpc = Rpc.make(PEER_CORE_METHODS.peerHubContextVersions, {
  payload: PeerHubContextInput,
  success: Schema.Array(PeerContextVersion),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubReadContextVersionRpc = Rpc.make(PEER_CORE_METHODS.peerHubReadContextVersion, {
  payload: PeerHubContextVersionInput,
  success: Schema.NullOr(PeerContextVersionText),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** A person brings an older version of a shared context back, as a new version. */
const WsPeerHubRestoreContextRpc = Rpc.make(PEER_CORE_METHODS.peerHubRestoreContext, {
  payload: PeerHubContextVersionInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubShareProjectRpc = Rpc.make(PEER_CORE_METHODS.peerHubShareProject, {
  payload: PeerHubShareProjectInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubUnshareProjectRpc = Rpc.make(PEER_CORE_METHODS.peerHubUnshareProject, {
  payload: PeerHubProjectInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubBindCheckoutRpc = Rpc.make(PEER_CORE_METHODS.peerHubBindCheckout, {
  payload: PeerHubBindCheckoutInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubFindWorkspaceRpc = Rpc.make(PEER_CORE_METHODS.peerHubFindWorkspace, {
  payload: PeerHubFindWorkspaceInput,
  success: Schema.NullOr(PeerFoundWorkspace),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubMembersRpc = Rpc.make(PEER_CORE_METHODS.peerHubMembers, {
  payload: PeerHubWorkspaceInput,
  success: PeerWorkspaceMembers,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubRemovalPlanRpc = Rpc.make(PEER_CORE_METHODS.peerHubRemovalPlan, {
  payload: PeerHubMemberInput,
  success: PeerRemovalPlan,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubRemoveMemberRpc = Rpc.make(PEER_CORE_METHODS.peerHubRemoveMember, {
  payload: PeerHubMemberInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubSetMemberRoleRpc = Rpc.make(PEER_CORE_METHODS.peerHubSetMemberRole, {
  payload: PeerHubMemberRoleInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubSetMemberProjectsRpc = Rpc.make(PEER_CORE_METHODS.peerHubSetMemberProjects, {
  payload: PeerHubMemberProjectsInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubWithdrawInviteRpc = Rpc.make(PEER_CORE_METHODS.peerHubWithdrawInvite, {
  payload: PeerHubMemberInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubMemberKeysRpc = Rpc.make(PEER_CORE_METHODS.peerHubMemberKeys, {
  payload: PeerHubMemberInput,
  success: PeerMemberKeys,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubRevokeMemberKeysRpc = Rpc.make(PEER_CORE_METHODS.peerHubRevokeMemberKeys, {
  payload: PeerHubMemberKeysInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubSignOutEverywhereRpc = Rpc.make(PEER_CORE_METHODS.peerHubSignOutEverywhere, {
  payload: Schema.Struct({}),
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** The signed-in person accepts an organization a hub administrator founded for them, as its owner. */
const WsPeerHubAcceptFoundingRpc = Rpc.make(PEER_CORE_METHODS.peerHubAcceptFounding, {
  payload: PeerHubFoundingInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

const WsPeerHubDeclineFoundingRpc = Rpc.make(PEER_CORE_METHODS.peerHubDeclineFounding, {
  payload: PeerHubFoundingInput,
  success: PeerHubStatus,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** A workspace's invitations with their states; null from a Hub that does not list them. */
const WsPeerHubInvitationsRpc = Rpc.make(PEER_CORE_METHODS.peerHubInvitations, {
  payload: PeerHubWorkspaceInput,
  success: Schema.NullOr(PeerInvitationList),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** What inviting an address would reach; null from a Hub that cannot say. */
const WsPeerHubInvitePreviewRpc = Rpc.make(PEER_CORE_METHODS.peerHubInvitePreview, {
  payload: PeerHubInvitePreviewInput,
  success: Schema.NullOr(PeerInvitePreview),
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

/** Sends a pending invitation again; it admits for another full period. */
const WsPeerHubResendInviteRpc = Rpc.make(PEER_CORE_METHODS.peerHubResendInvite, {
  payload: PeerHubMemberInput,
  success: PeerInvitation,
  error: Schema.Union([PeerHubError, EnvironmentAuthorizationError]),
});

export const PeerCoreRpcGroup = RpcGroup.make(
  WsPeerHubSubscribeRpc,
  WsPeerHubStartSignInRpc,
  WsPeerHubFinishSignInRpc,
  WsPeerHubMembersRpc,
  WsPeerHubRemovalPlanRpc,
  WsPeerHubRemoveMemberRpc,
  WsPeerHubSetMemberRoleRpc,
  WsPeerHubSetMemberProjectsRpc,
  WsPeerHubWithdrawInviteRpc,
  WsPeerHubMemberKeysRpc,
  WsPeerHubRevokeMemberKeysRpc,
  WsPeerHubSignOutEverywhereRpc,
  WsPeerHubSignOutRpc,
  WsPeerHubSyncRpc,
  WsPeerHubCreateWorkspaceRpc,
  WsPeerHubJoinWorkspaceRpc,
  WsPeerHubLeaveWorkspaceRpc,
  WsPeerHubFindWorkspaceRpc,
  WsPeerHubCreateTaskRpc,
  WsPeerHubUpdateTaskRpc,
  WsPeerHubDeleteTaskRpc,
  WsPeerHubAssignThreadRpc,
  WsPeerHubStartAgentRpc,
  WsPeerHubCoordEventsRpc,
  WsPeerHubStaleReadsRpc,
  WsPeerHubReadContextRpc,
  WsPeerHubContextViewRpc,
  WsPeerHubContextArchiveRpc,
  WsPeerHubContextVersionsRpc,
  WsPeerHubReadContextVersionRpc,
  WsPeerHubRestoreContextRpc,
  WsPeerHubShareProjectRpc,
  WsPeerHubUnshareProjectRpc,
  WsPeerHubBindCheckoutRpc,
  WsPeerHubInviteRpc,
  WsPeerHubOpenProjectRpc,
  WsPeerHubSetCoordinationRpc,
  WsPeerHubSetPluginRpc,
  WsPeerHubNoteOverlapRpc,
  WsPeerHubResolveOverlapRpc,
  WsPeerHubSettleOverlapRpc,
  WsPeerHubAcceptFoundingRpc,
  WsPeerHubDeclineFoundingRpc,
  WsPeerHubInvitationsRpc,
  WsPeerHubInvitePreviewRpc,
  WsPeerHubResendInviteRpc,
);

const PeerCoreRpcScopes = {
  // Signing in binds this environment to a person's workspaces, so it belongs to its owner.
  [PEER_CORE_METHODS.peerHubSubscribe]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubReadContext]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubContextView]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubContextArchive]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubContextVersions]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubReadContextVersion]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubRestoreContext]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubFindWorkspace]: AuthOrchestrationReadScope,
  // Tasks and threads are shared work, so changing them is operating, like starting a thread;
  // sharing a project hands the workspace a repository, and binding a checkout decides where this
  // computer's agents work on it, so both belong to the owner.
  [PEER_CORE_METHODS.peerHubCreateTask]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubUpdateTask]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubDeleteTask]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubAssignThread]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubStartAgent]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubCoordEvents]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubStaleReads]: AuthOrchestrationReadScope,
  [PEER_CORE_METHODS.peerHubShareProject]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubUnshareProject]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubBindCheckout]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubSync]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubOpenProject]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubSetCoordination]: AuthAccessWriteScope,
  // Which plugins run here is the environment owner's choice, like coordination itself.
  [PEER_CORE_METHODS.peerHubSetPlugin]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubNoteOverlap]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubResolveOverlap]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubSettleOverlap]: AuthOrchestrationOperateScope,
  [PEER_CORE_METHODS.peerHubStartSignIn]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubFinishSignIn]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubMembers]: AuthAccessReadScope,
  [PEER_CORE_METHODS.peerHubRemovalPlan]: AuthAccessReadScope,
  [PEER_CORE_METHODS.peerHubRemoveMember]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubSetMemberRole]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubSetMemberProjects]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubWithdrawInvite]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubMemberKeys]: AuthAccessReadScope,
  [PEER_CORE_METHODS.peerHubRevokeMemberKeys]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubSignOutEverywhere]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubSignOut]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubCreateWorkspace]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubJoinWorkspace]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubLeaveWorkspace]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubInvite]: AuthAccessWriteScope,
  // Accepting makes this environment's person an owner, like creating a workspace.
  [PEER_CORE_METHODS.peerHubAcceptFounding]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubDeclineFounding]: AuthAccessWriteScope,
  [PEER_CORE_METHODS.peerHubInvitations]: AuthAccessReadScope,
  [PEER_CORE_METHODS.peerHubInvitePreview]: AuthAccessReadScope,
  [PEER_CORE_METHODS.peerHubResendInvite]: AuthAccessWriteScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof PeerCoreRpcGroup>["_tag"], AuthEnvironmentScope>;

/** Every Peer method, as `WS_METHODS` spreads them. */
export const PEER_WS_METHODS = {
  ...PEER_RECIPES_METHODS,
  ...PEER_DIGEST_METHODS,
  ...PEER_RESOURCES_METHODS,
  ...PEER_FORECAST_METHODS,
  ...PEER_METRICS_METHODS,
  ...PEER_IMPACT_METHODS,
  ...PEER_PLANS_METHODS,
  ...PEER_AGREEMENTS_METHODS,
  ...PEER_CHANGES_METHODS,
  ...PEER_CORE_METHODS,
  ...PEER_DEPENDENCY_METHODS,
  ...PEER_HANDOFF_METHODS,
  ...PEER_HERDR_METHODS,
  ...PEER_JUJUTSU_METHODS,
  ...PEER_GITHUB_METHODS,
  ...PEER_CAPACITY_METHODS,
  ...PEER_REQUESTS_METHODS,
  ...PEER_OBSERVE_METHODS,
  ...PEER_KNOWLEDGE_METHODS,
  ...PEER_MEMORY_METHODS,
  ...PEER_WEBHOOKS_METHODS,
  ...PEER_MCP_METHODS,
  ...PEER_SLACK_METHODS,

  ...PEER_AUDIT_METHODS,
  ...PEER_TOOL_TRUST_METHODS,
  ...PEER_ANNOUNCEMENTS_METHODS,
  ...PEER_NEEDS_YOU_METHODS,
  ...PEER_SETTLE_METHODS,
  ...PEER_OWNERSHIP_METHODS,
  ...PEER_SETTINGS_METHODS,
  ...PEER_OPENSPEC_METHODS,
  ...PEER_TEST_REPORTS_METHODS,
  ...PEER_ROLES_METHODS,
  ...PEER_ACCEPTANCE_METHODS,
} as const;

export const PeerRpcGroup = PeerCoreRpcGroup.merge(
  RecipesRpcGroup,
  DigestRpcGroup,
  ResourcesRpcGroup,
  WsPeerForecastRpcGroup,
  MetricsRpcGroup,
  PeerImpactRpcs,
  PlansRpcGroup,
  AgreementsRpcGroup,
  ChangesRpcGroup,
  DependenciesRpcGroup,
  HandoffRpcGroup,
  HerdrRpcGroup,
  JujutsuRpcGroup,
  GitHubRpcGroup,
  CapacityRpcGroup,
  RequestsRpcGroup,
  ObserveRpcGroup,
  KnowledgeRpcGroup,
  MemoryRpcGroup,
  WebhooksRpcGroup,
  McpRpcGroup,
  SlackRpcGroup,

  AuditRpcGroup,
  PeerToolTrustRpcs,
  AnnouncementsRpcGroup,
  NeedsYouRpcGroup,
  SettleRpcGroup,
  OwnershipRpcGroup,
  SettingsRpcGroup,
  OpenSpecRpcGroup,
  TestReportsRpcGroup,
  RolesRpcGroup,
  AcceptanceRpcGroup,
);

/** The scope each Peer method needs, as the server's authorization table spreads them. */
export const PEER_RPC_SCOPES = {
  ...RecipesRpcScopes,
  ...DigestRpcScopes,
  ...ResourcesRpcScopes,
  ...ForecastRpcScopes,
  ...MetricsRpcScopes,
  ...ImpactRpcScopes,
  ...PlansRpcScopes,
  ...AgreementsRpcScopes,
  ...ChangesRpcScopes,
  ...PeerCoreRpcScopes,
  ...DependenciesRpcScopes,
  ...HandoffRpcScopes,
  ...HerdrRpcScopes,
  ...JujutsuRpcScopes,
  ...GitHubRpcScopes,
  ...CapacityRpcScopes,
  ...RequestsRpcScopes,
  ...ObserveRpcScopes,
  ...KnowledgeRpcScopes,
  ...MemoryRpcScopes,
  ...WebhooksRpcScopes,
  ...McpRpcScopes,
  ...SlackRpcScopes,

  ...AuditRpcScopes,
  ...ToolTrustRpcScopes,
  ...AnnouncementsRpcScopes,
  ...NeedsYouRpcScopes,
  ...SettleRpcScopes,
  ...OwnershipRpcScopes,
  ...SettingsRpcScopes,
  ...OpenSpecRpcScopes,
  ...TestReportsRpcScopes,
  ...RolesRpcScopes,
  ...AcceptanceRpcScopes,
} as const;

/** Peer's streaming methods: clients subscribe to them rather than call them. */
export const PEER_STREAM_METHODS = [
  PEER_FORECAST_METHODS.peerForecastSubscribe,
  PEER_CORE_METHODS.peerHubSubscribe,
  PEER_HERDR_METHODS.peerHubWatchAgent,
  PEER_CHANGES_METHODS.peerChangesSubscribe,
  PEER_OBSERVE_METHODS.peerHubObserveThread,
] as const;
