import type { EnvironmentId, PeerHubStatus, PeerWorkspaceState } from "@t3tools/contracts";

import { SettingsSection } from "../../../settings/settingsLayout";
import { GitHubChecksCard } from "../IntegrationsGitHub";
import { SlackCard } from "../IntegrationsSlack";
import { WebhooksCard } from "../IntegrationsWebhooks";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { AdminOnlyNote, PeerSettingsPage, RequirePlugin } from "../PeerSettingsPage";
import { HostedWorkspaceSettings } from "../PluginSlots";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsView } from "../useSettingsView";

/**
 * A workspace's Integrations page (design artboard 19): GitHub's PR checks, Slack and the webhooks,
 * each a card. Admins only. Each card needs its plugin; against a Hub without the settings feature
 * the cards read what they can, and GitHub's checks keep the setup they have always had (workspace
 * YAML and a secret set with the CLI), since the wizard and the webhook form write settings.
 */
export function Integrations({ environmentId, status, workspace }: WorkspacePageProps) {
  return (
    <PeerSettingsPage title="Integrations">
      {isWorkspaceAdmin(workspace.role) ? (
        <IntegrationsOfAdmin environmentId={environmentId} status={status} workspace={workspace} />
      ) : (
        <AdminOnlyNote workspace={workspace} />
      )}
    </PeerSettingsPage>
  );
}

function IntegrationsOfAdmin({
  environmentId,
  status,
  workspace,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: PeerWorkspaceState;
}) {
  const view = useSettingsView(workspace.slug);
  return (
    <>
      <SettingsUnavailableNote />
      <RequirePlugin status={status} plugin="github" title="GitHub">
        {view.hubHasSettings ? (
          <GitHubChecksCard environmentId={environmentId} workspace={workspace} />
        ) : (
          <SettingsSection title="GitHub" hideTitle>
            <HostedWorkspaceSettings
              host="integrations"
              environmentId={environmentId}
              status={status}
              workspace={workspace}
            />
          </SettingsSection>
        )}
      </RequirePlugin>
      <RequirePlugin status={status} plugin="slack" title="Slack">
        <SlackCard environmentId={environmentId} workspace={workspace} me={status.email} />
      </RequirePlugin>
      <RequirePlugin status={status} plugin="webhooks" title="Webhooks">
        <WebhooksCard environmentId={environmentId} workspace={workspace} />
      </RequirePlugin>
    </>
  );
}
