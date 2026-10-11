import { SettingsRow, SettingsSection } from "../../../settings/settingsLayout";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { ComingInThisChange, PeerSettingsPage } from "../PeerSettingsPage";

/**
 * Starting a project. Until the form exists, an admin still declares projects in the workspace
 * configuration, and a member asks a lead to be added.
 */
export function NewProject({ workspace }: WorkspacePageProps) {
  const admin = isWorkspaceAdmin(workspace.role);
  return (
    <PeerSettingsPage title="New project">
      <SettingsSection title="New project" hideTitle>
        <SettingsRow
          title={workspace.projects.length === 0 ? "No projects" : "Projects"}
          description={
            admin
              ? "Declare projects in the workspace configuration and apply it with `peerhub workspace apply`."
              : "The workspace lists the projects you are on in the sidebar. Ask a lead to add you to another."
          }
        />
      </SettingsSection>
      <ComingInThisChange>
        a form that creates the project and makes you its lead
      </ComingInThisChange>
    </PeerSettingsPage>
  );
}
