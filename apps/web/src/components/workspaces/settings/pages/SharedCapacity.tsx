import { SettingsSection } from "../../../settings/settingsLayout";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import {
  AdminOnlyNote,
  ComingInThisChange,
  PeerSettingsPage,
  RequirePlugin,
} from "../PeerSettingsPage";
import { HostedSettings } from "../PluginSlots";

/** A workspace's Shared capacity page: for now how shared capacity differs from a person's own plan. */
export function SharedCapacity({ environmentId, status, workspace }: WorkspacePageProps) {
  return (
    <PeerSettingsPage title="Shared capacity">
      {isWorkspaceAdmin(workspace.role) ? null : <AdminOnlyNote workspace={workspace} />}
      <RequirePlugin status={status} plugin="capacity" title="Shared capacity">
        <SettingsSection title="Shared capacity" hideTitle>
          <HostedSettings host="capacity" environmentId={environmentId} status={status} />
        </SettingsSection>
      </RequirePlugin>
      <ComingInThisChange>
        the gateway and its key, the model pools, and each project’s budget
      </ComingInThisChange>
    </PeerSettingsPage>
  );
}
