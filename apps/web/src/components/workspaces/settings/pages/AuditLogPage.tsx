import { SettingsSection } from "../../../settings/settingsLayout";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { AdminOnlyNote, PeerSettingsPage, RequirePlugin } from "../PeerSettingsPage";
import { HostedWorkspaceSettings } from "../PluginSlots";

/** A workspace's audit log: who changed members, configuration, projects and tasks. */
export function AuditLogPage({ environmentId, status, workspace }: WorkspacePageProps) {
  return (
    <PeerSettingsPage title="Audit log">
      {isWorkspaceAdmin(workspace.role) ? (
        <RequirePlugin status={status} plugin="audit" title="Audit log">
          <SettingsSection title="Activity" hideTitle>
            <HostedWorkspaceSettings
              host="audit"
              environmentId={environmentId}
              status={status}
              workspace={workspace}
            />
          </SettingsSection>
        </RequirePlugin>
      ) : (
        <AdminOnlyNote workspace={workspace} />
      )}
    </PeerSettingsPage>
  );
}
