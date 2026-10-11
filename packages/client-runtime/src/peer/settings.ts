import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import type { AsyncResult, Atom } from "effect/unstable/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  request,
  type EnvironmentRpcFailure,
  type EnvironmentRpcInput,
  type EnvironmentRpcSuccess,
  type EnvironmentRpcUnavailableError,
  type EnvironmentUnaryRpcTag,
} from "../rpc/client.ts";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
  type EnvironmentRpcCommand,
} from "../state/runtime.ts";

type Methods = typeof WS_METHODS;

/** A query family keyed by the signed-in person, whose `person` is part of the key and never sent. */
export type PeerSettingsQuery<Tag extends EnvironmentUnaryRpcTag, ER> = (target: {
  readonly environmentId: EnvironmentId;
  readonly person: string;
  readonly input: EnvironmentRpcInput<Tag>;
}) => Atom.Atom<
  AsyncResult.AsyncResult<
    EnvironmentRpcSuccess<Tag>,
    EnvironmentRpcFailure<Tag> | EnvironmentRpcUnavailableError | ER | Error
  >
>;

/** A write, run on an atom registry with the environment and the RPC's own input. */
export type PeerSettingsCommand<Tag extends EnvironmentUnaryRpcTag, ER> = EnvironmentRpcCommand<
  Tag,
  ER
>;

/**
 * What `createPeerSettingsAtoms` makes, named so that the type of `serverEnvironment`, which holds
 * every plugin's atoms, refers to it instead of spelling out its twenty-four RPC types: the
 * declaration emit of a client that is a composite project fails once that type grows too long.
 */
export interface PeerSettingsAtoms<ER> {
  readonly view: PeerSettingsQuery<Methods["peerSettingsGet"], ER>;
  readonly history: PeerSettingsQuery<Methods["peerSettingsHistory"], ER>;
  readonly historyEntry: PeerSettingsQuery<Methods["peerSettingsHistoryEntry"], ER>;
  readonly proposals: PeerSettingsQuery<Methods["peerSettingsProposals"], ER>;
  readonly secrets: PeerSettingsQuery<Methods["peerSettingsSecrets"], ER>;
  readonly gateway: PeerSettingsQuery<Methods["peerSettingsGateway"], ER>;
  readonly domainRecord: PeerSettingsQuery<Methods["peerSettingsDomainRecord"], ER>;
  readonly preview: PeerSettingsCommand<Methods["peerSettingsPreview"], ER>;
  readonly save: PeerSettingsCommand<Methods["peerSettingsSave"], ER>;
  readonly revert: PeerSettingsCommand<Methods["peerSettingsRevert"], ER>;
  readonly importYaml: PeerSettingsCommand<Methods["peerSettingsImportYaml"], ER>;
  readonly exportYaml: PeerSettingsCommand<Methods["peerSettingsExportYaml"], ER>;
  readonly propose: PeerSettingsCommand<Methods["peerSettingsPropose"], ER>;
  readonly applyProposal: PeerSettingsCommand<Methods["peerSettingsApplyProposal"], ER>;
  readonly declineProposal: PeerSettingsCommand<Methods["peerSettingsDeclineProposal"], ER>;
  readonly withdrawProposal: PeerSettingsCommand<Methods["peerSettingsWithdrawProposal"], ER>;
  readonly putSecret: PeerSettingsCommand<Methods["peerSettingsPutSecret"], ER>;
  readonly deleteSecret: PeerSettingsCommand<Methods["peerSettingsDeleteSecret"], ER>;
  readonly gatewayTest: PeerSettingsCommand<Methods["peerSettingsGatewayTest"], ER>;
  readonly gatewaySync: PeerSettingsCommand<Methods["peerSettingsGatewaySync"], ER>;
  readonly githubEnable: PeerSettingsCommand<Methods["peerSettingsGithubEnable"], ER>;
  readonly githubDisable: PeerSettingsCommand<Methods["peerSettingsGithubDisable"], ER>;
  readonly verifyDomain: PeerSettingsCommand<Methods["peerSettingsVerifyDomain"], ER>;
  readonly updateWorkspace: PeerSettingsCommand<Methods["peerSettingsUpdateWorkspace"], ER>;
}

/**
 * The settings plugin's atoms. What a person may see of a workspace's settings is theirs alone, so
 * every query is keyed by the signed-in person (`person`, the address), which is never sent: a
 * person who signs in on the same environment never meets what the one before read. A query's
 * `revision` in its input tells it from an older one, and the proposals' also `waiting` and `own`,
 * the pending proposals the person decides and made: pass what `status.settings` says, and it
 * reads again when that changes.
 */
export function createPeerSettingsAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
): PeerSettingsAtoms<ER> {
  const query = <Tag extends EnvironmentUnaryRpcTag>(name: string, tag: Tag) => {
    const family = createEnvironmentQueryAtomFamily(runtime, {
      label: `peer:settings:${name}`,
      staleTimeMs: 30_000,
      idleTtlMs: 60_000,
      execute: ({ person: _person, ...input }: EnvironmentRpcInput<Tag> & { person: string }) =>
        request(tag, input as unknown as EnvironmentRpcInput<Tag>),
    });
    return (target: {
      readonly environmentId: EnvironmentId;
      readonly person: string;
      readonly input: EnvironmentRpcInput<Tag>;
    }) =>
      family({
        environmentId: target.environmentId,
        input: { ...target.input, person: target.person },
      });
  };
  /** A save, revert, import or applied proposal waits for the one before it in its workspace. */
  const inOrder = {
    mode: "serial",
    key: ({
      environmentId,
      input,
    }: {
      readonly environmentId: EnvironmentId;
      readonly input: unknown;
    }) =>
      `${environmentId}/${
        typeof input === "object" && input !== null && "workspace" in input
          ? String(input.workspace)
          : ""
      }`,
  } as const;
  const command = <Tag extends EnvironmentUnaryRpcTag>(name: string, tag: Tag) =>
    createEnvironmentRpcCommand(runtime, { label: `peer:settings:${name}`, tag });
  const change = <Tag extends EnvironmentUnaryRpcTag>(name: string, tag: Tag) =>
    createEnvironmentRpcCommand(runtime, {
      label: `peer:settings:${name}`,
      tag,
      concurrency: inOrder,
    });

  return {
    view: query("view", WS_METHODS.peerSettingsGet),
    history: query("history", WS_METHODS.peerSettingsHistory),
    historyEntry: query("history-entry", WS_METHODS.peerSettingsHistoryEntry),
    proposals: query("proposals", WS_METHODS.peerSettingsProposals),
    secrets: query("secrets", WS_METHODS.peerSettingsSecrets),
    gateway: query("gateway", WS_METHODS.peerSettingsGateway),
    domainRecord: query("domain-record", WS_METHODS.peerSettingsDomainRecord),
    preview: command("preview", WS_METHODS.peerSettingsPreview),
    save: change("save", WS_METHODS.peerSettingsSave),
    revert: change("revert", WS_METHODS.peerSettingsRevert),
    importYaml: change("import-yaml", WS_METHODS.peerSettingsImportYaml),
    exportYaml: command("export-yaml", WS_METHODS.peerSettingsExportYaml),
    propose: command("propose", WS_METHODS.peerSettingsPropose),
    applyProposal: change("apply-proposal", WS_METHODS.peerSettingsApplyProposal),
    declineProposal: command("decline-proposal", WS_METHODS.peerSettingsDeclineProposal),
    withdrawProposal: command("withdraw-proposal", WS_METHODS.peerSettingsWithdrawProposal),
    putSecret: command("put-secret", WS_METHODS.peerSettingsPutSecret),
    deleteSecret: command("delete-secret", WS_METHODS.peerSettingsDeleteSecret),
    gatewayTest: command("gateway-test", WS_METHODS.peerSettingsGatewayTest),
    gatewaySync: command("gateway-sync", WS_METHODS.peerSettingsGatewaySync),
    githubEnable: command("github-enable", WS_METHODS.peerSettingsGithubEnable),
    githubDisable: change("github-disable", WS_METHODS.peerSettingsGithubDisable),
    verifyDomain: command("verify-domain", WS_METHODS.peerSettingsVerifyDomain),
    updateWorkspace: command("update-workspace", WS_METHODS.peerSettingsUpdateWorkspace),
  };
}
