/**
 * The facts Settings › Overview and the navigation's "to finish" badge are told from, read from the
 * queries the settings pages already use (no request of its own): the Hub's status, and source control, the providers, the browser and device settings of
 * this computer. Queries are only asked for what the person may see: an admin's for admins.
 */
import { useLocation } from "@tanstack/react-router";

import { deviceEnvironment } from "../../state/device";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { sourceControlEnvironment } from "../../state/sourceControl";
import {
  useLastPeerWorkspace,
  usePeerSettingsEnvironment,
} from "../workspaces/settings/PeerSettingsContext";
import {
  currentNavWorkspace,
  environmentIsComing,
  parsePeerSettingsPath,
} from "../workspaces/settings/peerSettings.logic";
import { factOfQuery } from "./connectionFacts";
import {
  overviewRows,
  overviewSummary,
  type OverviewFacts,
  type OverviewGroup,
  type OverviewSummary,
  type PeerAccess,
  type WorkspaceFacts,
} from "./overview.logic";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";

function useOverviewFacts(): OverviewFacts {
  const { environment, connected, status } = usePeerSettingsEnvironment();
  const { environments } = useEnvironments();
  const [lastWorkspace] = useLastPeerWorkspace();
  const pathname = useLocation({ select: (location) => location.pathname });

  const environmentId = connected && environment !== null ? environment.environmentId : null;
  const signedIn = environmentId !== null && status !== null && status.signedIn ? status : null;
  const workspace =
    signedIn === null
      ? null
      : currentNavWorkspace(signedIn.workspaces, parsePeerSettingsPath(pathname), lastWorkspace);

  const discovery = useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
  const serverConfig = connected ? (environment?.serverConfig ?? null) : null;
  const deviceHubOn = serverConfig?.settings.enableDeviceSupport === true;
  const device = useEnvironmentQuery(
    deviceHubOn && environmentId !== null
      ? deviceEnvironment.state({ environmentId, input: {} })
      : null,
  );

  // Provider statuses live apart from the server config since upstream's presentation split.
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    environmentId === null ? null : (providersByEnvironment.get(environmentId) ?? null);
  const workspaceFacts: WorkspaceFacts | null =
    workspace === null
      ? null
      : {
          slug: workspace.slug,
          name: workspace.name,
          role: workspace.role,
        };
  const peer: PeerAccess =
    environment === null || !connected
      ? environmentIsComing(environment)
        ? { kind: "loading" }
        : { kind: "disconnected" }
      : status === null
        ? { kind: "loading" }
        : { kind: "ready", peer: { status, workspace: workspaceFacts } };
  return {
    peer,
    computer: {
      ...(environmentId === null ? {} : { environmentId }),
      name: environment === null ? null : settingsScopeEnvironmentLabel(environment, environments),
      sourceControl: environmentId === null ? null : factOfQuery(discovery),
      providers,
      agentBrowser: serverConfig === null ? null : serverConfig.settings.enableAgentBrowserAccess,
      deviceHub:
        serverConfig === null
          ? null
          : {
              enabled: deviceHubOn,
              status: device.data?.hostStatus ?? null,
              detail: device.data?.hostStatusDetail ?? null,
            },
    },
  };
}

/** The Overview's groups and what is left to finish, for the page and the navigation. */
export function useOverview(): {
  readonly groups: ReadonlyArray<OverviewGroup>;
  readonly summary: OverviewSummary;
} {
  const groups = overviewRows(useOverviewFacts());
  return { groups, summary: overviewSummary(groups) };
}
