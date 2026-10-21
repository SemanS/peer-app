import { SettingsSection } from "../../../settings/settingsLayout";
import { HistoryList } from "../HistoryList";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { AdminOnlyNote, PeerSettingsPage, RequirePlugin } from "../PeerSettingsPage";
import { HostedWorkspaceSettings } from "../PluginSlots";

/**
 * A workspace's audit log: every revision of its settings, then who changed members, keys,
 * configuration, projects and tasks.
 */
export function AuditLogPage({ environmentId, status, workspace }: WorkspacePageProps) {
  return (
    <PeerSettingsPage title="Audit log">
      {isWorkspaceAdmin(workspace.role) ? (
        <>
          <HistoryList workspace={workspace} heading="Settings history" />
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
        </>
      ) : (
        <AdminOnlyNote workspace={workspace} />
      )}
    </PeerSettingsPage>
  );
}
