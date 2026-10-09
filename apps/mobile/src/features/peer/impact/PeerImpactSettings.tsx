import { useState } from "react";
import { Pressable, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import * as Clipboard from "expo-clipboard";
import { canChangePeerPlugins } from "@t3tools/client-runtime/peer/plugins";
import {
  impactControl,
  impactHubLabel,
  impactRootLabel,
} from "@t3tools/client-runtime/peer/impact";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../../components/AppText";
import { ThemedSwitch } from "../../../components/ThemedSwitch";
import { SettingsSection } from "../../settings/components/SettingsSection";
import { serverEnvironment } from "../../../state/server";
import { environmentSession } from "../../../state/session";
import { useAtomCommand } from "../../../state/use-atom-command";
import type { PeerSectionProps } from "../slotTypes";

export function PeerImpactSettings({ environmentId, status }: PeerSectionProps) {
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId)),
    owner = canChangePeerPlugins(session),
    plugin = status.plugins?.find((p) => p.id === "impact"),
    setting = impactControl(status.impact, plugin);
  const setPlugin = useAtomCommand(serverEnvironment.peerHubSetPlugin, { reportFailure: false }),
    configure = useAtomCommand(serverEnvironment.peerImpactConfigure, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!plugin) return null;
  async function change(value: boolean, indexing = false) {
    if (!owner || setting.locked || busy || (indexing && !plugin?.active)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await (indexing
        ? configure({ environmentId, input: { autoIndex: value } })
        : setPlugin({ environmentId, input: { id: "impact", enabled: value } }));
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsSection title="Impact overlaps">
      <View className="gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <Text className="flex-1 text-foreground">Impact overlaps</Text>
          <ThemedSwitch
            accessibilityLabel="Impact overlaps"
            value={setting.on}
            disabled={!owner || setting.locked || busy}
            onValueChange={(value) => void change(value)}
          />
        </View>
        <Text className="text-foreground-muted">{setting.reason}</Text>
        <View className="flex-row items-center gap-3">
          <Text className="flex-1 text-foreground">Index new Peer task worktrees</Text>
          <ThemedSwitch
            accessibilityLabel="Index new Peer task worktrees"
            value={status.impact?.autoIndex ?? false}
            disabled={!owner || setting.locked || !plugin.active || busy}
            onValueChange={(value) => void change(value, true)}
          />
        </View>
        <Text className="text-foreground-muted">
          Opt in to initialize only new Peer task worktrees. Existing checkouts are never
          initialized automatically.
        </Text>
        <Text className="text-foreground-muted">
          {impactHubLabel(status.impact)}{" "}
          {status.impact?.lastContact
            ? `Last contact: ${status.impact.lastContact}.`
            : "No impact contact yet."}
        </Text>
        {status.impact?.roots.map((root) => (
          <View key={root.root} className="gap-1">
            <Text selectable className="text-foreground">
              {root.root}
            </Text>
            <Text className="text-foreground-muted">{impactRootLabel(root)}</Text>
            {root.commands.map((command) => (
              <View key={command} className="gap-1">
                <Text selectable className="text-foreground">
                  {command}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    void Clipboard.setStringAsync(command).catch(() =>
                      setError("Could not copy the command. Select and copy it above."),
                    );
                  }}
                >
                  <Text className="text-primary">Copy command</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ))}
        {!status.impact?.roots.length ? (
          <Text className="text-foreground-muted">
            No local checkout has been checked yet. Install CodeGraph on the environment hosting
            your agents and initialize each checkout you want to use.
          </Text>
        ) : null}
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      </View>
    </SettingsSection>
  );
}
