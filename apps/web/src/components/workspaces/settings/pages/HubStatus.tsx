import { verificationReadKey } from "@t3tools/client-runtime/peer/github";
import { inactivePluginReason } from "@t3tools/client-runtime/peer/plugins";
import type { ReactNode } from "react";

import { useEnvironmentQuery } from "../../../../state/query";
import { formatRelativeTimeLabel } from "../../../../timestampFormat";
import { factOfQuery } from "../../../settings/connectionFacts";
import { ConnectionBadge } from "../../../settings/ConnectionStatus";
import { useRelativeTimeTick } from "../../../settings/settingsLayout";
import { PeerCard } from "../../PeerPageHeader";
import { slackAtoms } from "../../slack/atoms";
import {
  HUB_DESCRIPTION,
  featuresFootnote,
  hubAddress,
  hubBuild,
  hubFeatureRows,
  projectsWithPathRules,
} from "../hubStatus.logic";
import { githubFactConnection } from "../integrations.logic";
import { useGitHubChecksStatus } from "../IntegrationsGitHub";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { PeerSettingsPage } from "../PeerSettingsPage";
import { slackAdminConnection, slackMemberConnection } from "../slackConnection.logic";
import { useSettingsView } from "../useSettingsView";

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <PeerCard className="gap-0.5 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-sm text-foreground">{children}</span>
    </PeerCard>
  );
}

/**
 * The Hub this computer is signed in to (design artboard 23): read only, since its operator changes
 * it. Its address, build and the last sync, and each of its features in the status language:
 * Connected, Not available (the operator's choice, or a Hub that needs an update) or Off on this
 * computer, with what it means for the workspace. Slack and GitHub's checks are also the
 * workspace's to connect, so they say Needs setup (at its step) or Off until that is done. A Hub
 * says its build and its features in the answer that tells who is signed in; one that says less (an
 * older Hub) leaves the page to the plugins' states and the settings read.
 */
export function HubStatus({ environmentId, status, workspace }: WorkspacePageProps) {
  useRelativeTimeTick(60_000);
  const view = useSettingsView(workspace.slug);
  const admin = isWorkspaceAdmin(workspace.role);
  const input = { workspace: workspace.slug };
  // What the workspace connected is read only where the Hub serves the feature to this computer.
  const slackOn = inactivePluginReason(status, "slack") === null;
  const githubOn = inactivePluginReason(status, "github") === null;
  const slackAdmin = useEnvironmentQuery(
    slackOn && admin ? slackAtoms.admin({ environmentId, input }) : null,
  );
  const slackMe = useEnvironmentQuery(
    slackOn && !admin ? slackAtoms.me({ environmentId, input }) : null,
  );
  const github = useGitHubChecksStatus(
    githubOn
      ? {
          environmentId,
          workspace: workspace.slug,
          moved: verificationReadKey(status, workspace),
        }
      : null,
  );
  const features = hubFeatureRows({
    plugins: status.plugins,
    hub: status.hub,
    flags: view.features,
    pathRuleProjects: projectsWithPathRules(view.document),
    connections: {
      ...(slackOn
        ? {
            slack: admin
              ? slackAdminConnection(factOfQuery(slackAdmin), workspace.name)
              : slackMemberConnection(factOfQuery(slackMe), workspace.name),
          }
        : {}),
      ...(githubOn ? { github: githubFactConnection(github.fact) } : {}),
    },
  });
  const build = hubBuild(status.hub);
  return (
    <PeerSettingsPage title="Hub" description={HUB_DESCRIPTION}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Address">
          <span className="font-mono text-xs">{hubAddress(status.hubUrl)}</span>
        </Fact>
        {build === null ? null : (
          <Fact label="Version">
            <span className="flex items-baseline gap-1.5">
              {build.version === null ? null : (
                <span className="font-semibold">{build.version}</span>
              )}
              {build.commit === null ? null : (
                <span className="font-mono text-xs text-muted-foreground">{build.commit}</span>
              )}
            </span>
          </Fact>
        )}
        <Fact label="Synced">
          {status.lastSyncAt ? formatRelativeTimeLabel(status.lastSyncAt) : "Not yet"}
        </Fact>
        {view.revision === null ? null : <Fact label="Settings">revision {view.revision}</Fact>}
      </div>
      <section aria-labelledby="hub-features" className="flex flex-col gap-2.5">
        <h2 id="hub-features" className="text-sm font-semibold text-foreground">
          Features
        </h2>
        <ul
          aria-label="Features of the Hub"
          className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
        >
          {features.map((feature) => (
            <li
              key={feature.id}
              className="grid gap-x-3 gap-y-1 px-3.5 py-2.5 sm:grid-cols-[10rem_12rem_minmax(0,1fr)] sm:items-center"
            >
              <span className="text-sm font-medium text-foreground">{feature.name}</span>
              <span className="flex items-center">
                <ConnectionBadge state={feature.connection} label={feature.label} />
              </span>
              <span className="text-sm text-muted-foreground">{feature.effect}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{featuresFootnote(features)}</p>
      </section>
    </PeerSettingsPage>
  );
}
