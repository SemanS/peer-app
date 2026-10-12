/**
 * Everything settings search looks through: the app's settings that exist on this computer, and
 * Peer's pages, sections and fields for the workspace and projects the person has open. A result
 * of Peer's carries where its connection stands (from the Overview) when that is worth a badge.
 */
import { useMemo } from "react";
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
  // The Overview is told again on every render; its badges change rarely, so the entries follow
  // them by value and are not rebuilt (and re-ranked) each time.
  const badges = JSON.stringify(overviewStatuses(overview));
  return useMemo(
    () => [
      ...settings,
      ...peerSearchItems({
        signedIn: signedIn !== null,
        workspace,
        status: signedIn ?? undefined,
        statuses: JSON.parse(badges) as Readonly<Record<string, string>>,
      }),
    ],
    [badges, settings, signedIn, workspace],
  );
}
