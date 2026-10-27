/**
 * Everything settings search looks through: the app's settings that exist on this computer, and
 * Peer's pages, sections and fields for the workspace and projects the person has open. A result
 * of Peer's carries where its connection stands (from the Overview) when that is worth a badge.
 */

import { useLocation } from "@tanstack/react-router";

import {
  useLastPeerWorkspace,
  usePeerSettingsEnvironment,
} from "../workspaces/settings/PeerSettingsContext";
import {
  currentNavWorkspace,
  parsePeerSettingsPath,
} from "../workspaces/settings/peerSettings.logic";
import { peerSearchItems } from "../workspaces/settings/peerSettingsSearch.logic";
import { CONNECTION_STATE_LABEL } from "./connectionStatus.logic";
import type { OverviewGroup } from "./overview.logic";
import type { SettingsScopeSearch } from "./settingsScope";
import type { SettingsSearchEntry } from "./settingsSearch";
import { useAvailableSettingsSearchItems } from "./useAvailableSettingsSearchItems";

/** The badge each Overview row that needs attention gives its search results, by the row's id. */
function overviewStatuses(groups: ReadonlyArray<OverviewGroup>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    groups.flatMap((group) =>
      group.rows.flatMap((row) => (row.badge === null ? [] : [[row.id, row.badge] as const])),
    ),
  );
}

export function useSettingsSearchEntries(
  scopeSearch: SettingsScopeSearch,
  overview: ReadonlyArray<OverviewGroup>,
): ReadonlyArray<SettingsSearchEntry> {
  const settings = useAvailableSettingsSearchItems(scopeSearch);
  const { connected, status } = usePeerSettingsEnvironment();
  const [lastWorkspace] = useLastPeerWorkspace();
  const pathname = useLocation({ select: (location) => location.pathname });
  const signedIn = connected && status !== null && status.signedIn ? status : null;
  const workspace =
    signedIn === null
      ? null
      : currentNavWorkspace(signedIn.workspaces, parsePeerSettingsPath(pathname), lastWorkspace);
  // Search follows the same connection facts and scoped actions as the Overview.
  const badges = JSON.stringify(overviewStatuses(overview));
  const services: SettingsSearchEntry[] = overview.flatMap((group) =>
    group.rows.flatMap((row): SettingsSearchEntry[] => {
      if (row.action === null) return [];
      const target = row.action.target;
      const connectionLabel = row.connection.label ?? CONNECTION_STATE_LABEL[row.connection.state];
      const needsSignIn = [row.connection.step?.title, row.connection.detail].some((text) =>
        text?.toLowerCase().includes("sign in"),
      );
      const action =
        row.connection.state === "setup"
          ? needsSignIn
            ? "Sign in"
            : "Set up"
          : row.connection.state === "problem"
            ? "Fix connection"
            : row.connection.state === "connected"
              ? "Connected"
              : row.action.label;
      const common = {
        id: `service:${row.id}`,
        title: `${row.name} → ${action}`,
        directAction: true,
        searchTerms: [
          row.name,
          action,
          row.connection.detail ?? "",
          "connection settings authentication sign in setup",
        ],
        status: connectionLabel,
        statusTone: row.attention ? ("warning" as const) : ("neutral" as const),
        ...(target.targetId === undefined ? {} : { targetId: target.targetId }),
      };
      if (target.kind === "peer")
        return [{ ...common, location: target.location, path: [group.title, row.name] }];
      const service = {
        ...common,
        to: target.to,
        targetId: target.targetId ?? target.to.split("/").at(-1) ?? "overview",
        ...(target.instanceId === undefined ? {} : { instanceId: target.instanceId }),
        ...(target.environmentId === undefined ? {} : { environmentId: target.environmentId }),
      };
      return target.instanceId === undefined
        ? [service]
        : [
            service,
            {
              ...service,
              id: `${common.id}:authentication`,
              title: `${row.name} → API key and authentication`,
              searchTerms: [row.name, "api key token credentials authentication sign in"],
            },
          ];
    }),
  );
  return [
    ...services,
    ...settings,
    ...peerSearchItems({
      signedIn: signedIn !== null,
      workspace,
      status: signedIn ?? undefined,
      statuses: JSON.parse(badges) as Readonly<Record<string, string>>,
    }),
  ];
}
