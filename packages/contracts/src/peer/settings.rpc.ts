import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerDomainRecord,
  PeerSettingsApplyProposalInput,
  PeerSettingsChangeInput,
  PeerSettingsChangeResult,
  PeerSettingsDeclineProposalInput,
  PeerSettingsDeleteSecretInput,
  PeerSettingsDeleteSecretResult,
  PeerSettingsDomainCheck,
  PeerSettingsDomainInput,
  PeerSettingsExport,
  PeerSettingsGatewayTest,
  PeerSettingsGatewayView,
  PeerSettingsGetInput,
  PeerSettingsGitHubDisableInput,
  PeerSettingsGitHubEnableInput,
  PeerSettingsGitHubSetup,
  PeerSettingsHistoryEntryInput,
  PeerSettingsHistoryInput,
  PeerSettingsHistoryPage,
  PeerSettingsImportInput,
  PeerSettingsProposal,
  PeerSettingsProposalInput,
  PeerSettingsProposals,
  PeerSettingsProposalsInput,
  PeerSettingsProposeInput,
  PeerSettingsProposeResult,
  PeerSettingsPutSecretInput,
  PeerSettingsRevertInput,
  PeerSettingsRevisionDetail,
  PeerSettingsSecretsView,
  PeerSettingsSync,
  PeerSettingsUpdateWorkspaceInput,
  PeerSettingsView,
  PeerSettingsWorkspaceInput,
  PeerSettingsWorkspaceUpdate,
} from "./settings.ts";

export const PEER_SETTINGS_METHODS = {
  peerSettingsGet: "peer.settings.get",
  peerSettingsPreview: "peer.settings.preview",
  peerSettingsSave: "peer.settings.save",
  peerSettingsHistory: "peer.settings.history",
  peerSettingsHistoryEntry: "peer.settings.historyEntry",
  peerSettingsRevert: "peer.settings.revert",
  peerSettingsImportYaml: "peer.settings.importYaml",
  peerSettingsExportYaml: "peer.settings.exportYaml",
  peerSettingsProposals: "peer.settings.proposals",
  peerSettingsPropose: "peer.settings.propose",
  peerSettingsApplyProposal: "peer.settings.applyProposal",
  peerSettingsDeclineProposal: "peer.settings.declineProposal",
  peerSettingsWithdrawProposal: "peer.settings.withdrawProposal",
  peerSettingsSecrets: "peer.settings.secrets",
  peerSettingsPutSecret: "peer.settings.putSecret",
  peerSettingsDeleteSecret: "peer.settings.deleteSecret",
  peerSettingsGateway: "peer.settings.gateway",
  peerSettingsGatewayTest: "peer.settings.gatewayTest",
  peerSettingsGatewaySync: "peer.settings.gatewaySync",
  peerSettingsGithubEnable: "peer.settings.githubEnable",
  peerSettingsGithubDisable: "peer.settings.githubDisable",
  peerSettingsDomainRecord: "peer.settings.domainRecord",
  peerSettingsVerifyDomain: "peer.settings.verifyDomain",
  peerSettingsUpdateWorkspace: "peer.settings.updateWorkspace",
} as const;

const methods = PEER_SETTINGS_METHODS;
const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);
/** An answer with nothing in it, such as the Hub's `204`. */
const Done = Schema.Struct({});

export const SettingsRpcGroup = RpcGroup.make(
  Rpc.make(methods.peerSettingsGet, {
    payload: PeerSettingsGetInput,
    success: PeerSettingsView,
    error,
  }),
  Rpc.make(methods.peerSettingsPreview, {
    payload: PeerSettingsChangeInput,
    success: PeerSettingsChangeResult,
    error,
  }),
  Rpc.make(methods.peerSettingsSave, {
    payload: PeerSettingsChangeInput,
    success: PeerSettingsChangeResult,
    error,
  }),
  Rpc.make(methods.peerSettingsHistory, {
    payload: PeerSettingsHistoryInput,
    success: PeerSettingsHistoryPage,
    error,
  }),
  Rpc.make(methods.peerSettingsHistoryEntry, {
    payload: PeerSettingsHistoryEntryInput,
    success: PeerSettingsRevisionDetail,
    error,
  }),
  Rpc.make(methods.peerSettingsRevert, {
    payload: PeerSettingsRevertInput,
    success: PeerSettingsChangeResult,
    error,
  }),
  Rpc.make(methods.peerSettingsImportYaml, {
    payload: PeerSettingsImportInput,
    success: PeerSettingsChangeResult,
    error,
  }),
  Rpc.make(methods.peerSettingsExportYaml, {
    payload: PeerSettingsWorkspaceInput,
    success: PeerSettingsExport,
    error,
  }),
  Rpc.make(methods.peerSettingsProposals, {
    payload: PeerSettingsProposalsInput,
    success: PeerSettingsProposals,
    error,
  }),
  Rpc.make(methods.peerSettingsPropose, {
    payload: PeerSettingsProposeInput,
    success: PeerSettingsProposeResult,
    error,
  }),
  Rpc.make(methods.peerSettingsApplyProposal, {
    payload: PeerSettingsApplyProposalInput,
    success: PeerSettingsChangeResult,
    error,
  }),
  Rpc.make(methods.peerSettingsDeclineProposal, {
    payload: PeerSettingsDeclineProposalInput,
    success: PeerSettingsProposal,
    error,
  }),
  Rpc.make(methods.peerSettingsWithdrawProposal, {
    payload: PeerSettingsProposalInput,
    success: Done,
    error,
  }),
  Rpc.make(methods.peerSettingsSecrets, {
    payload: PeerSettingsWorkspaceInput,
    success: PeerSettingsSecretsView,
    error,
  }),
  Rpc.make(methods.peerSettingsPutSecret, {
    payload: PeerSettingsPutSecretInput,
    success: Done,
    error,
  }),
  Rpc.make(methods.peerSettingsDeleteSecret, {
    payload: PeerSettingsDeleteSecretInput,
    success: PeerSettingsDeleteSecretResult,
    error,
  }),
  Rpc.make(methods.peerSettingsGateway, {
    payload: PeerSettingsWorkspaceInput,
    success: PeerSettingsGatewayView,
    error,
  }),
  Rpc.make(methods.peerSettingsGatewayTest, {
    payload: PeerSettingsWorkspaceInput,
    success: PeerSettingsGatewayTest,
    error,
  }),
  Rpc.make(methods.peerSettingsGatewaySync, {
    payload: PeerSettingsWorkspaceInput,
    success: PeerSettingsSync,
    error,
  }),
  Rpc.make(methods.peerSettingsGithubEnable, {
    payload: PeerSettingsGitHubEnableInput,
    success: PeerSettingsGitHubSetup,
    error,
  }),
  Rpc.make(methods.peerSettingsGithubDisable, {
    payload: PeerSettingsGitHubDisableInput,
    success: PeerSettingsChangeResult,
    error,
  }),
  Rpc.make(methods.peerSettingsDomainRecord, {
    payload: PeerSettingsDomainInput,
    success: PeerDomainRecord,
    error,
  }),
  Rpc.make(methods.peerSettingsVerifyDomain, {
    payload: PeerSettingsDomainInput,
    success: PeerSettingsDomainCheck,
    error,
  }),
  Rpc.make(methods.peerSettingsUpdateWorkspace, {
    payload: PeerSettingsUpdateWorkspaceInput,
    success: PeerSettingsWorkspaceUpdate,
    error,
  }),
);

/**
 * Reads need access-read. A dry run changes nothing, so `preview` is a read; everything that can
 * save, store, remove, sync, check or call out with a stored key needs access-write.
 */
export const SettingsRpcScopes = {
  [methods.peerSettingsGet]: AuthAccessReadScope,
  [methods.peerSettingsPreview]: AuthAccessReadScope,
  [methods.peerSettingsSave]: AuthAccessWriteScope,
  [methods.peerSettingsHistory]: AuthAccessReadScope,
  [methods.peerSettingsHistoryEntry]: AuthAccessReadScope,
  [methods.peerSettingsRevert]: AuthAccessWriteScope,
  [methods.peerSettingsImportYaml]: AuthAccessWriteScope,
  [methods.peerSettingsExportYaml]: AuthAccessReadScope,
  [methods.peerSettingsProposals]: AuthAccessReadScope,
  [methods.peerSettingsPropose]: AuthAccessWriteScope,
  [methods.peerSettingsApplyProposal]: AuthAccessWriteScope,
  [methods.peerSettingsDeclineProposal]: AuthAccessWriteScope,
  [methods.peerSettingsWithdrawProposal]: AuthAccessWriteScope,
  [methods.peerSettingsSecrets]: AuthAccessReadScope,
  [methods.peerSettingsPutSecret]: AuthAccessWriteScope,
  [methods.peerSettingsDeleteSecret]: AuthAccessWriteScope,
  [methods.peerSettingsGateway]: AuthAccessReadScope,
  [methods.peerSettingsGatewayTest]: AuthAccessWriteScope,
  [methods.peerSettingsGatewaySync]: AuthAccessWriteScope,
  [methods.peerSettingsGithubEnable]: AuthAccessWriteScope,
  [methods.peerSettingsGithubDisable]: AuthAccessWriteScope,
  [methods.peerSettingsDomainRecord]: AuthAccessReadScope,
  [methods.peerSettingsVerifyDomain]: AuthAccessWriteScope,
  [methods.peerSettingsUpdateWorkspace]: AuthAccessWriteScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof SettingsRpcGroup>["_tag"], AuthEnvironmentScope>;
