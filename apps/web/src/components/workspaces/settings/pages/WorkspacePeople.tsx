import { SettingsRow, SettingsSection } from "../../../settings/settingsLayout";
import { WorkspaceMembers } from "../../WorkspaceMembers";
import { InviteRow } from "../InviteRow";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { ComingInThisChange, PeerSettingsPage } from "../PeerSettingsPage";
import { HostedWorkspaceSettings } from "../PluginSlots";

/**
 * A workspace's People page. Owners and admins invite, change roles and remove people with the
 * rows the Workspaces page had; everyone else is told who does.
 */
export function WorkspacePeople({ environmentId, status, workspace }: WorkspacePageProps) {
  const admin = isWorkspaceAdmin(workspace.role);
  return (
    <PeerSettingsPage title="People">
      <SettingsSection title="People" hideTitle>
        {admin ? (
          <>
            <InviteRow environmentId={environmentId} workspace={workspace} />
            <WorkspaceMembers
              environmentId={environmentId}
              workspace={workspace}
              email={status.email}
            />
          </>
        ) : (
          <SettingsRow
            title="Members"
            description={`Owners and admins of ${workspace.name} invite and remove people and change roles. Ask one of them.`}
          />
        )}
        <HostedWorkspaceSettings
          host="people"
          environmentId={environmentId}
          status={status}
          workspace={workspace}
        />
      </SettingsSection>
      <ComingInThisChange>
        the member list with roles and allocations, invites with a role, and removal that shows its
        consequences
      </ComingInThisChange>
    </PeerSettingsPage>
  );
}
