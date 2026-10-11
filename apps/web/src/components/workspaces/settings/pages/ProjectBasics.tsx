import { SettingsRow, SettingsSection } from "../../../settings/settingsLayout";
import type { ProjectPageProps } from "../pageProps";
import { ComingInThisChange } from "../PeerSettingsPage";
import { HostedProjectSettings } from "../PluginSlots";

/**
 * A project's Basics tab. For now its description and the rows plugins add to a project
 * (announcement credentials, metrics, handoff).
 */
export function ProjectBasics({ environmentId, status, workspace, state }: ProjectPageProps) {
  return (
    <>
      <SettingsSection title="Basics" hideTitle>
        <SettingsRow
          title="Description"
          description={state.project.description ?? "No description yet."}
        />
        <HostedProjectSettings
          host="basics"
          environmentId={environmentId}
          status={status}
          workspace={workspace}
          state={state}
        />
      </SettingsSection>
      <ComingInThisChange>
        the project’s name, client and description, its knowledge switches, and deleting it
      </ComingInThisChange>
    </>
  );
}
