import { useEnvironment } from "../../../../state/environments";
import { SettingsRow, SettingsSection } from "../../../settings/settingsLayout";
import { CoordinationControls } from "../../Coordination";
import { PeerPluginsSettings } from "../../PeerPluginsSettings";
import type { ComputerPageProps } from "../pageProps";
import { ComingInThisChange, PeerSettingsPage } from "../PeerSettingsPage";
import { HostedSettings } from "../PluginSlots";

/**
 * This computer's coordination and plugins: how its agents coordinate with the team's, which Peer
 * plugins are on, and the settings plugins bring (herdr, GitHub CLI, metrics and the rest).
 */
export function CoordinationAndPlugins({ environmentId, status }: ComputerPageProps) {
  const environment = useEnvironment(environmentId);
  return (
    <PeerSettingsPage
      title="Coordination & plugins"
      description={environment === null ? "This computer" : `This computer · ${environment.label}`}
    >
      <SettingsSection title="Coordination & plugins" hideTitle>
        <SettingsRow
          title="Agent coordination (experimental)"
          description="Agents check shared projects before tracked edits, exchange short updates, and request the context they need. Project rules come from Peer Hub."
        >
          <CoordinationControls environmentId={environmentId} status={status} />
        </SettingsRow>
        <PeerPluginsSettings environmentId={environmentId} status={status} />
        <HostedSettings host="coordination" environmentId={environmentId} status={status} />
      </SettingsSection>
      <ComingInThisChange>
        your default policy with the projects that override it, and each plugin with where its
        setting comes from
      </ComingInThisChange>
    </PeerSettingsPage>
  );
}
