import { useEnvironment } from "../../../../state/environments";
import { SettingsRow, SettingsSection } from "../../../settings/settingsLayout";
import { CoordinationControls } from "../../Coordination";
import { DefaultPolicy, PeerPluginsSection } from "../CoordinationAndPluginsParts";
import type { ComputerPageProps } from "../pageProps";
import { PeerSettingsPage } from "../PeerSettingsPage";
import { HostedSettings } from "../PluginSlots";

/**
 * This computer's coordination and plugins (design artboard 13): the default policy its agents
 * follow where a project sets none, with the projects it applies to and those that set their own;
 * the Peer plugins, each with where its state comes from; and under them what the page held
 * before: the switch for agent coordination, Claude Code and Codex hooks, and Codex's trust
 * (the default policy moved up), and the settings plugins bring (herdr, GitHub CLI, metrics and
 * the rest). These are this computer's own, so whoever uses it sees them whatever workspace is open.
 */
export function CoordinationAndPlugins({ environmentId, status }: ComputerPageProps) {
  const environment = useEnvironment(environmentId);
  return (
    <PeerSettingsPage
      title="Coordination & plugins"
      description={environment === null ? "This computer" : `This computer · ${environment.label}`}
    >
      <DefaultPolicy environmentId={environmentId} status={status} />
      <PeerPluginsSection environmentId={environmentId} status={status} />
      <SettingsSection title="Agent coordination" hideTitle>
        <SettingsRow
          title="Agent coordination (experimental)"
          description="Agents coordinate in repositories opened on this environment, with no Hub account required. Connecting a Hub adds coordination across teammates’ computers and shared project rules."
        >
          <CoordinationControls environmentId={environmentId} status={status} hidePolicy />
        </SettingsRow>
        <HostedSettings host="coordination" environmentId={environmentId} status={status} />
      </SettingsSection>
    </PeerSettingsPage>
  );
}
