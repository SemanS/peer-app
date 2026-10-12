/**
 * The facts Settings › Overview and the navigation's "to finish" badge are told from, read from the
 * queries the settings pages already use (no request of its own): the Hub's status, Slack's admin
 * and member views, the webhooks, GitHub's checks, the gateway and the person's plans for the
 * workspace the area has open, and source control, the providers, the browser and device settings of
 * this computer. Queries are only asked for what the person may see: an admin's for admins.
 */
import { getAt, planLabel } from "@t3tools/client-runtime/peer-settings";
import { inactivePluginReason } from "@t3tools/client-runtime/peer/plugins";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { deviceEnvironment } from "../../state/device";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { harnessShort, personKey, readPlans } from "../workspaces/settings/aiSubscriptions.logic";
import { useGitHubChecksStatus } from "../workspaces/settings/IntegrationsGitHub";
import {
  useLastPeerWorkspace,
  usePeerSettingsEnvironment,
} from "../workspaces/settings/PeerSettingsContext";
import {
  currentNavWorkspace,
  isWorkspaceAdmin,
  parsePeerSettingsPath,
} from "../workspaces/settings/peerSettings.logic";
import { readCatalogPools } from "../workspaces/settings/sharedCapacity.logic";
import { knownRevision } from "../workspaces/settings/settingsView.logic";
import { slackAtoms } from "../workspaces/slack/atoms";
import { webhookAtoms } from "../workspaces/webhooks/atoms";
import { LOADING, factOfQuery, failedFact, readyFact } from "./connectionFacts";
import { detectedPlanCount } from "./overviewComputer.logic";
import {
  overviewRows,
  overviewSummary,
  type OverviewFacts,
  type OverviewGroup,
  type OverviewSummary,
  type PeerAccess,
  type PlansFact,
  type WorkspaceFacts,
} from "./overview.logic";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";

export function useOverviewFacts(): OverviewFacts {
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
  const email = signedIn?.email ?? null;
  const admin = workspace !== null && isWorkspaceAdmin(workspace.role);
  const active = (plugin: string) =>
    signedIn !== null && inactivePluginReason(signedIn, plugin) === null;
  const asking = environmentId !== null && slug !== null ? { environmentId, slug } : null;
  const input = slug === null ? null : { workspace: slug };

  const slackOn = asking !== null && active("slack");
  const slackAdmin = useEnvironmentQuery(
    slackOn && admin && input !== null
      ? slackAtoms.admin({ environmentId: asking.environmentId, input })
      : null,
  );
  const slackMe = useEnvironmentQuery(
    slackOn && input !== null
      ? slackAtoms.me({ environmentId: asking.environmentId, input })
      : null,
  );
  const webhooks = useEnvironmentQuery(
    asking !== null && admin && active("webhooks") && input !== null
      ? webhookAtoms.list({ environmentId: asking.environmentId, input })
      : null,
  );
  const github = useGitHubChecksStatus(
    asking !== null && admin && active("github")
      ? { environmentId: asking.environmentId, workspace: asking.slug }
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

  const settingsOn = asking !== null && email !== null && active("settings");
  const revision = signedIn === null || slug === null ? undefined : knownRevision(signedIn, slug);
  const settings = useEnvironmentQuery(
    settingsOn && input !== null
      ? serverEnvironment.peerSettings.view({
          environmentId: asking.environmentId,
          person: email,
          input: revision === undefined ? input : { ...input, revision },
        })
      : null,
  );
  const gateway = useEnvironmentQuery(
    settingsOn && admin && active("capacity") && input !== null
      ? serverEnvironment.peerSettings.gateway({
          environmentId: asking.environmentId,
          person: email,
          input,
        })
      : null,
  );

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

  const document = settings.data?.document ?? null;
  const providers = serverConfig?.providers ?? null;
  const planRows =
    document === null || email === null
      ? []
      : readPlans(getAt(document, ["people", personKey(document, email)]));
  const plans: PlansFact = !settingsOn
    ? { kind: "unavailable" }
    : document === null
      ? settings.error === null
        ? { kind: "loading" }
        : { kind: "unavailable" }
      : {
          kind: "ready",
          added: planRows.map((row) => `${harnessShort(row.harness)} ${planLabel(row.plan)}`),
          detected: detectedPlanCount(
            providers ?? [],
            planRows.map((row) => row.harness),
          ),
        };
  const gatewayFact: WorkspaceFacts["gateway"] =
    !settingsOn || !admin
      ? null
      : gateway.error !== null
        ? failedFact(gateway.error)
        : gateway.data === null
          ? LOADING
          : readyFact({
              view: gateway.data,
              pools: document === null ? null : readCatalogPools(document).length,
            });
  const workspaceFacts: WorkspaceFacts | null =
    workspace === null
      ? null
      : {
          slug: workspace.slug,
          name: workspace.name,
          role: workspace.role,
          slackAdmin: slackOn && admin ? factOfQuery(slackAdmin) : null,
          slackMe: slackOn ? factOfQuery(slackMe) : null,
          webhooks: admin ? factOfQuery(webhooks) : null,
          github: admin ? github.fact : null,
          gateway: gatewayFact,
          plans,
        };
  const peer: PeerAccess =
    environment === null || !connected
      ? { kind: "disconnected" }
      : status === null
        ? { kind: "loading" }
        : { kind: "ready", peer: { status, workspace: workspaceFacts } };
  return {
    peer,
    computer: {
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
