import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { AdminOnlyNote, ComingInThisChange, PeerSettingsPage } from "../PeerSettingsPage";

/** The workspace's secrets: names and what uses them, never the values. Admins only. */
export function Secrets({ workspace }: WorkspacePageProps) {
  return (
    <PeerSettingsPage title="Secrets">
      {isWorkspaceAdmin(workspace.role) ? null : <AdminOnlyNote workspace={workspace} />}
      <ComingInThisChange>
        the workspace’s secrets by name, what uses each one, and storing or removing one
      </ComingInThisChange>
    </PeerSettingsPage>
  );
}
