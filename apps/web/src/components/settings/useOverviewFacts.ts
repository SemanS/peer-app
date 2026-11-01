/**
 * The facts Settings › Overview and the navigation's "to finish" badge are told from, read from the
 * queries the settings pages already use (no request of its own): the Hub's status and GitHub's
 * checks for the workspace the area has open, and source control, the providers, the browser and device settings of
 * this computer. Queries are only asked for what the person may see: an admin's for admins.
 */
import { verificationReadKey } from "@t3tools/client-runtime/peer/github";
import { inactivePluginReason } from "@t3tools/client-runtime/peer/plugins";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { deviceEnvironment } from "../../state/device";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useGitHubChecksStatus } from "../workspaces/settings/IntegrationsGitHub";
import {
  useLastPeerWorkspace,
  usePeerSettingsEnvironment,
} from "../workspaces/settings/PeerSettingsContext";
import {
  currentNavWorkspace,
  environmentIsComing,
  isWorkspaceAdmin,
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
  const slug = workspace?.slug ?? null;
  const admin = workspace !== null && isWorkspaceAdmin(workspace.role);
  const active = (plugin: string) =>
    signedIn !== null && inactivePluginReason(signedIn, plugin) === null;
  const asking = environmentId !== null && slug !== null ? { environmentId, slug } : null;

  const github = useGitHubChecksStatus(
    asking !== null && admin && active("github") && signedIn !== null && workspace !== null
      ? {
          environmentId: asking.environmentId,
          workspace: asking.slug,
          moved: verificationReadKey(signedIn, workspace),
        }
      : null,
  );
  // GitHub's checks are a command, not a query: read them again when the person moves to another
  // page, so the badge follows a setup they just finished.
  const lastPath = useRef(pathname);
  const reloadGitHub = github.reload;
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    reloadGitHub();
  }, [pathname, reloadGitHub]);

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
          github: admin ? github.fact : null,
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
