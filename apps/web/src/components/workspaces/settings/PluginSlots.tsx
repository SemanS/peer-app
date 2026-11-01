/**
 * Plugins fill three settings slots (`settings`, `alwaysSettings`, `workspaceSettings`) without
 * knowing where the page that shows them is. `slotHost` says which page
 * of the area hosts each plugin's slot; a page renders the ones hosted on it.
 */
import type { ReactNode } from "react";

import { PEER_WEB_PLUGINS, usePeerPlugins } from "../slots";
import type { PeerSlotProps, WorkspaceSettingsSlotProps } from "../slots.types";
import { slotHost, type SlotHost } from "./peerSettings.logic";

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
