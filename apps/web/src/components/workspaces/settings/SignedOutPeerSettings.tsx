import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";

import { SettingsRow, SettingsSection } from "../../settings/settingsLayout";
import { PeerPluginsSettings } from "../PeerPluginsSettings";
import { CoordinationControls } from "../Coordination";
import { LocalWork } from "../LocalWork";
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
      <LocalWork status={status} />
      <SettingsSection title="Local agent coordination">
        <CoordinationControls environmentId={environmentId} status={status} />
      </SettingsSection>
      <SettingsSection title="Optional team Hub">
        <SettingsRow
          title="Connect Peer Hub"
          description="Share projects, coordination and knowledge across your team’s computers. Hosted Hub is free for two people with unlimited interactions; larger teams need a Team entitlement."
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
