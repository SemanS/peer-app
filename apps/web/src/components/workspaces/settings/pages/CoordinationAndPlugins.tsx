import { useEnvironment } from "../../../../state/environments";
import { SettingsRow, SettingsSection } from "../../../settings/settingsLayout";
import { CoordinationControls } from "../../Coordination";
import { DefaultPolicy, PeerPluginsSection } from "../CoordinationAndPluginsParts";
import type { ComputerPageProps } from "../pageProps";
import { PeerSettingsPage } from "../PeerSettingsPage";
import { HostedSettings } from "../PluginSlots";

/**
 * This computer's coordination and plugins: first what decides whether its agents take part at
 * all (the switch, Claude Code and Codex hooks, Codex's trust) with the settings plugins bring
 * (herdr, GitHub CLI and the rest), then the default policy where a project sets none, and
 * the Peer plugins folded, as most people never change one. These are this computer's own, so
 * whoever uses it sees them whatever workspace is open.
 */
export function CoordinationAndPlugins({ environmentId, status }: ComputerPageProps) {
  const environment = useEnvironment(environmentId);
  return (
    <PeerSettingsPage
      title="Coordination & plugins"
      description={environment === null ? "This computer" : `This computer · ${environment.label}`}
    >
      <SettingsSection title="Agent coordination" hideTitle>
        <SettingsRow
          title="Agent coordination"
          description="Agents coordinate in repositories opened on this environment, with no Hub account required. Connecting a Hub adds coordination across teammates’ computers and shared project rules."
        >
          <CoordinationControls environmentId={environmentId} status={status} hidePolicy />
        </SettingsRow>
        <HostedSettings host="coordination" environmentId={environmentId} status={status} />
      </SettingsSection>
      <DefaultPolicy environmentId={environmentId} status={status} />
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">Peer plugins</summary>
        <div className="pt-4">
          <PeerPluginsSection environmentId={environmentId} status={status} />
        </div>
      </details>
    </PeerSettingsPage>
  );
}
