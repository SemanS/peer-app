import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerDomainRecord,
  PeerSettingsChangeInput,
  PeerSettingsChangeResult,
  PeerSettingsDeleteSecretInput,
  PeerSettingsDomainCheck,
  PeerSettingsDomainInput,
  PeerSettingsGetInput,
  PeerSettingsPutSecretInput,
  PeerSettingsSecretsView,
  PeerSettingsUpdateWorkspaceInput,
  PeerSettingsView,
  PeerSettingsWorkspaceInput,
  PeerSettingsWorkspaceUpdate,
} from "./settings.ts";

export const PEER_SETTINGS_METHODS = {
  peerSettingsGet: "peer.settings.get",
  peerSettingsPreview: "peer.settings.preview",
  peerSettingsSave: "peer.settings.save",
  peerSettingsSecrets: "peer.settings.secrets",
  peerSettingsPutSecret: "peer.settings.putSecret",
  peerSettingsDeleteSecret: "peer.settings.deleteSecret",
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
    success: Done,
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
  [methods.peerSettingsSecrets]: AuthAccessReadScope,
  [methods.peerSettingsPutSecret]: AuthAccessWriteScope,
  [methods.peerSettingsDeleteSecret]: AuthAccessWriteScope,
  [methods.peerSettingsDomainRecord]: AuthAccessReadScope,
  [methods.peerSettingsVerifyDomain]: AuthAccessWriteScope,
  [methods.peerSettingsUpdateWorkspace]: AuthAccessWriteScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof SettingsRpcGroup>["_tag"], AuthEnvironmentScope>;
