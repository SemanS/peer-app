import { useAtomValue } from "@effect/atom-react";
import { canChangePeerPlugins, pluginLockNote } from "@t3tools/client-runtime/peer/plugins";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { PEER_MEMORY_AVAILABLE, type PeerPluginState } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import type { PeerEnvironmentProps } from "./slotTypes";

function stateText(plugin: PeerPluginState): string {
  if (!plugin.enabled) return "Off";
  return plugin.reason === "hub" ? "Needs a newer Hub" : "On";
}

/**
 * Peer plugins on one environment: the owner turns each off or on, and everyone else reads the
 * state. A choice applies at once; one the Hub cannot serve says the Hub must be updated, and a
 * cleanup that failed when a plugin was turned off shows with it.
 */
export function PeerPluginsSection({ environmentId, status }: PeerEnvironmentProps) {
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId));
  const owner = canChangePeerPlugins(session);
  const setPlugin = useAtomCommand(serverEnvironment.peerHubSetPlugin, { reportFailure: false });
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const plugins = (status.plugins ?? []).filter(
    (plugin) => plugin.id !== "memory" || PEER_MEMORY_AVAILABLE,
  );
  if (plugins.length === 0) return null;

  const toggle = (plugin: PeerPluginState, enabled: boolean) => {
    setPending(plugin.id);
    setFailure(null);
    void setPlugin({ environmentId, input: { id: plugin.id, enabled } })
      .then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setFailure(
            `Could not change ${plugin.title}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })
      .finally(() => setPending(null));
  };

  return (
    <SettingsSection title="Peer plugins">
      <Text className="p-4 text-foreground-muted">
        Turn Peer’s features off or on for this environment. A change applies at once.
      </Text>
      {plugins.map((plugin) => (
        <View key={plugin.id} className="flex-row items-center gap-4 p-4">
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-lg text-foreground">{plugin.title}</Text>
            {pluginLockNote(plugin) ? (
              <Text className="text-sm text-foreground-muted">{pluginLockNote(plugin)}</Text>
            ) : null}
            {plugin.enabled && plugin.reason === "hub" ? (
              <Text className="text-sm text-foreground-muted">
                The Hub must be updated before this works.
              </Text>
            ) : null}
            {plugin.error === undefined ? null : (
              <Text className="text-sm text-destructive">{plugin.error}</Text>
            )}
          </View>
          {owner ? (
            <ThemedSwitch
              style={{ alignSelf: "center" }}
              accessibilityLabel={`Use ${plugin.title} on this environment`}
              disabled={pending === plugin.id || plugin.locked === true}
              onValueChange={(enabled) => toggle(plugin, enabled)}
              value={plugin.enabled}
            />
          ) : (
            <Text className="text-foreground-muted">{stateText(plugin)}</Text>
          )}
        </View>
      ))}
      {failure === null ? null : (
        <Text accessibilityRole="alert" className="p-4 text-foreground">
          {failure}
        </Text>
      )}
    </SettingsSection>
  );
}
