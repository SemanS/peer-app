import { SettingsSection } from "../../../settings/settingsLayout";
import { usePeerPlugins } from "../../slots";
import { WorkspaceSlack } from "../../slack/SlackSection";
import { WorkspaceWebhooks } from "../../webhooks/PeerWebhooks";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { AdminOnlyNote, ComingInThisChange, PeerSettingsPage } from "../PeerSettingsPage";
import { HostedWorkspaceSettings, hostsSlot } from "../PluginSlots";

/**
 * A workspace's Integrations page: GitHub's pull request checks, the webhooks, and Slack's setup,
 * each as the Workspaces page had them. A person's own Slack options are under Me.
 */
export function Integrations({ environmentId, status, workspace }: WorkspacePageProps) {
  const plugins = usePeerPlugins(status);
  const admin = isWorkspaceAdmin(workspace.role);
  const webhooks = admin && plugins.some((plugin) => plugin.id === "webhooks");
  const slack = admin && plugins.some((plugin) => plugin.id === "slack");
  const github = hostsSlot(plugins, "workspaceSettings", "integrations");
  return (
    <PeerSettingsPage title="Integrations">
      {admin ? null : <AdminOnlyNote workspace={workspace} />}
      {github || webhooks || slack ? (
        <SettingsSection title="Integrations" hideTitle>
          <HostedWorkspaceSettings
            host="integrations"
            environmentId={environmentId}
            status={status}
            workspace={workspace}
          />
          {webhooks ? (
            <WorkspaceWebhooks environmentId={environmentId} workspace={workspace} />
          ) : null}
          {slack ? (
            <WorkspaceSlack environmentId={environmentId} workspace={workspace} part="setup" />
          ) : null}
        </SettingsSection>
      ) : null}
      <ComingInThisChange>
        a wizard for GitHub’s pull request checks, webhooks you add and edit here, and Slack members
        you can disconnect
      </ComingInThisChange>
    </PeerSettingsPage>
  );
}
