import { SettingsSection } from "../../../settings/settingsLayout";
import type { ProjectPageProps } from "../pageProps";
import { ComingInThisChange, RequirePlugin } from "../PeerSettingsPage";
import { HostedProjectSettings } from "../PluginSlots";

/**
 * A project's Capacity tab: what its policy allows on personal plans, its shared budget and the
 * person's share of it, as shared capacity shows them for a project.
 */
export function ProjectCapacity({ environmentId, status, workspace, state }: ProjectPageProps) {
  return (
    <>
      <RequirePlugin status={status} plugin="capacity" title="Shared capacity">
        <SettingsSection title="Capacity" hideTitle>
          <HostedProjectSettings
            host="project-capacity"
            environmentId={environmentId}
            status={status}
            workspace={workspace}
            state={state}
          />
        </SettingsSection>
      </RequirePlugin>
      <ComingInThisChange>
        the budget and each person’s allocation against it, and the rule for personal plans
      </ComingInThisChange>
    </>
  );
}
