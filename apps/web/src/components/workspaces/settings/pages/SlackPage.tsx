import { SlackMePage } from "../../slack/SlackMePage";
import { slackAdminNames } from "../../slack/slack.logic";
import type { WorkspacePageProps } from "../pageProps";
import { PeerSettingsPage, RequirePlugin } from "../PeerSettingsPage";
import { useSettingsView } from "../useSettingsView";

/**
 * The person’s own Slack in a workspace: the account they linked and what Peer posts there. One
 * heading, the workspace under it. Before the workspace connects Slack the page is still here: an
 * admin finds the way to the setup, a member the admins’ names.
 */
export function SlackPage({ environmentId, status, workspace }: WorkspacePageProps) {
  const view = useSettingsView(workspace.slug);
  return (
    <PeerSettingsPage title="Slack" description={workspace.name}>
      <RequirePlugin status={status} plugin="slack" title="Slack">
        <SlackMePage
          environmentId={environmentId}
          workspace={workspace}
          admins={slackAdminNames(view.people)}
        />
      </RequirePlugin>
    </PeerSettingsPage>
  );
}
