import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { View } from "react-native";
import { canChangePeerPlugins } from "@t3tools/client-runtime/peer/plugins";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../../components/ui/AppText";
import { ThemedSwitch } from "../../../components/ui/ThemedSwitch";
import { environmentSession } from "../../../state/session";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerSectionProps } from "../slotTypes";
import { announcementAtoms } from "./atoms";
export function AnnouncementPreferences({ environmentId, status }: PeerSectionProps) {
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId));
  const owner = canChangePeerPlugins(session);
  const setWake = useAtomCommand(announcementAtoms.setWake, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(wake: boolean) {
    setBusy(true);
    try {
      const result = await setWake({ environmentId, input: { wake } });
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : String(failure));
      } else setError(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsSection title="Announcement delivery">
      <View className="gap-3 p-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-foreground">Wake idle agents for announcements</Text>
          <ThemedSwitch
            accessibilityLabel="Wake idle agents for announcements"
            value={status.announcements?.wake ?? true}
            disabled={busy || !owner}
            onValueChange={(value) => void change(value)}
          />
        </View>
        <Text className="text-sm text-foreground-muted">
          Turn announcement delivery off or on in Peer plugins. Working agents hear announcements at
          their next step.
        </Text>
        {error ? (
          <Text accessibilityRole="alert" className="text-foreground">
            {error}
          </Text>
        ) : null}
      </View>
    </SettingsSection>
  );
}
