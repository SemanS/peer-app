import { toolTrustReview } from "@t3tools/client-runtime/peer-tool-trust";

import { SettingsSection } from "../../../settings/settingsLayout";
import type { ComputerPageProps } from "../pageProps";
import { PeerSettingsPage, RequirePlugin } from "../PeerSettingsPage";
import { HostedSettings } from "../PluginSlots";

/** What the workspaces' tools may do on this computer: approvals and the secrets they get. */
export function ToolTrustPage({ environmentId, status }: ComputerPageProps) {
  return (
    <PeerSettingsPage
      title="Tool trust"
      description="Tools a workspace proposes run on this computer only after you approve them."
    >
      <RequirePlugin status={status} plugin="tool-trust" title="Tool trust">
        {toolTrustReview(status).length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            No workspace tools to review on this computer.
          </p>
        ) : (
          <SettingsSection title="Tool trust" hideTitle>
            <HostedSettings host="tool-trust" environmentId={environmentId} status={status} />
          </SettingsSection>
        )}
      </RequirePlugin>
    </PeerSettingsPage>
  );
}
