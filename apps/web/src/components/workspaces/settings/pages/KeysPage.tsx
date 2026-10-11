import { SettingsSection } from "../../../settings/settingsLayout";
import { MemberKeys } from "../../MemberKeys";
import type { WorkspacePageProps } from "../pageProps";
import { PeerSettingsPage } from "../PeerSettingsPage";

/** The person's own shared-capacity keys in a workspace, on each of their computers. */
export function KeysPage({ environmentId, status, workspace }: WorkspacePageProps) {
  return (
    <PeerSettingsPage title="Keys">
      <SettingsSection title="Keys" hideTitle>
        {status.email === null ? null : (
          <MemberKeys
            asRow
            environmentId={environmentId}
            workspace={workspace.slug}
            email={status.email}
          />
        )}
      </SettingsSection>
    </PeerSettingsPage>
  );
}
