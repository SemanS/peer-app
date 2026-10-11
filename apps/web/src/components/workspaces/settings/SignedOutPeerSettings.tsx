import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";

import { SettingsRow, SettingsSection } from "../../settings/settingsLayout";
import { PeerPluginsSettings } from "../PeerPluginsSettings";
import { WorkspaceSignIn } from "../WorkspaceAccess";
import { PeerSettingsPage } from "./PeerSettingsPage";

/**
 * What the area shows until someone is signed in on the environment: the email sign-in, and the
 * environment's plugins, which stay on or off whether or not anyone is signed in.
 */
export function SignedOutPeerSettings({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}) {
  return (
    <PeerSettingsPage title="Peer">
      <SettingsSection title="Sign in" hideTitle>
        <SettingsRow
          title="Sign in"
          description="Sign in with your work email to join your team’s workspace, or to create one. Workspaces share projects, tools, knowledge and AI capacity."
        >
          <div className="max-w-md pb-3">
            <WorkspaceSignIn environmentId={environmentId} status={status} />
          </div>
        </SettingsRow>
        <PeerPluginsSettings environmentId={environmentId} status={status} />
      </SettingsSection>
    </PeerSettingsPage>
  );
}
