import { SettingsSection } from "../../../settings/settingsLayout";
import { WorkspaceSlack } from "../../slack/SlackSection";
import type { WorkspacePageProps } from "../pageProps";
import { PeerSettingsPage, RequirePlugin } from "../PeerSettingsPage";

/** The person's own Slack in a workspace: the link to their account and what Peer posts there. */
export function SlackPage({ environmentId, status, workspace }: WorkspacePageProps) {
  return (
    <PeerSettingsPage title="Slack">
      <RequirePlugin status={status} plugin="slack" title="Slack">
        <SettingsSection title="Slack" hideTitle>
          <WorkspaceSlack
            environmentId={environmentId}
            workspace={workspace}
            part="member"
            defaultOpen
          />
        </SettingsSection>
      </RequirePlugin>
    </PeerSettingsPage>
  );
}
