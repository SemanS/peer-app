/**
 * Plugins fill four settings slots (`settings`, `alwaysSettings`, `workspaceSettings`,
 * `projectSettings`) without knowing where the page that shows them is. `slotHost` says which page
 * of the area hosts each plugin's slot; a page renders the ones hosted on it.
 */
import type { ReactNode } from "react";

import { PEER_WEB_PLUGINS, usePeerPlugins, type PeerWebPlugin } from "../slots";
import type {
  PeerSlotProps,
  ProjectSettingsSlotProps,
  WorkspaceSettingsSlotProps,
} from "../slots.types";
import { slotHost, type SlotHost, type SlotKind } from "./peerSettings.logic";

/** Whether an active plugin has a slot of this kind hosted on the page. */
export function hostsSlot(
  plugins: ReadonlyArray<PeerWebPlugin>,
  kind: SlotKind,
  host: SlotHost,
): boolean {
  return plugins.some((plugin) => plugin[kind] !== undefined && slotHost(kind, plugin.id) === host);
}

/**
 * The environment-wide rows of the plugins hosted on a page: the active plugins' `settings`, and
 * the `alwaysSettings` of the registered plugins the environment lists, active or not.
 */
export function HostedSettings({
  host,
  environmentId,
  status,
}: PeerSlotProps & { readonly host: SlotHost }): ReactNode {
  const plugins = usePeerPlugins(status);
  return (
    <>
      {plugins.map(({ id, settings: Rows }) =>
        Rows !== undefined && slotHost("settings", id) === host ? (
          <Rows key={id} environmentId={environmentId} status={status} />
        ) : null,
      )}
      {PEER_WEB_PLUGINS.map(({ id, alwaysSettings: Rows }) =>
        Rows !== undefined &&
        slotHost("alwaysSettings", id) === host &&
        status.plugins?.some((plugin) => plugin.id === id) ? (
          <Rows key={`always:${id}`} environmentId={environmentId} status={status} />
        ) : null,
      )}
    </>
  );
}

/** The rows of the active plugins' `workspaceSettings` hosted on a page, for one workspace. */
export function HostedWorkspaceSettings({
  host,
  environmentId,
  status,
  workspace,
}: WorkspaceSettingsSlotProps & { readonly host: SlotHost }): ReactNode {
  const plugins = usePeerPlugins(status);
  return plugins.map(({ id, workspaceSettings: Section }) =>
    Section !== undefined && slotHost("workspaceSettings", id) === host ? (
      <Section key={id} environmentId={environmentId} status={status} workspace={workspace} />
    ) : null,
  );
}

/** The rows of the active plugins' `projectSettings` hosted on a page, for one project. */
export function HostedProjectSettings({
  host,
  environmentId,
  status,
  workspace,
  state,
}: ProjectSettingsSlotProps & { readonly host: SlotHost }): ReactNode {
  const plugins = usePeerPlugins(status);
  return plugins.map(({ id, projectSettings: Rows }) =>
    Rows !== undefined && slotHost("projectSettings", id) === host ? (
      <Rows
        key={id}
        environmentId={environmentId}
        status={status}
        workspace={workspace}
        state={state}
      />
    ) : null,
  );
}
