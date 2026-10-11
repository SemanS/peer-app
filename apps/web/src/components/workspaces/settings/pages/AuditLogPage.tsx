import { SettingsSection } from "../../../settings/settingsLayout";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import {
  AdminOnlyNote,
  ComingInThisChange,
  PeerSettingsPage,
  RequirePlugin,
} from "../PeerSettingsPage";
import { HostedWorkspaceSettings } from "../PluginSlots";

/** A workspace's audit log: who changed members, keys, configuration, projects and tasks. */
export function AuditLogPage({ environmentId, status, workspace }: WorkspacePageProps) {
  return (
    <PeerSettingsPage title="Audit log">
      {isWorkspaceAdmin(workspace.role) ? (
        <RequirePlugin status={status} plugin="audit" title="Audit log">
          <SettingsSection title="Audit log" hideTitle>
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
      <ComingInThisChange>
        every revision of the workspace’s settings, above the audit list
      </ComingInThisChange>
    </PeerSettingsPage>
  );
}
