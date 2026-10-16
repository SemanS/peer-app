import { useEffect, useState } from "react";
import { Alert, AppState, Pressable, View } from "react-native";
import {
  heldResources,
  mayRelease,
  needsReleaseConfirmation,
  releaseInput,
  resourceLabel,
  resourceTimeLeft,
  createResourcesEnvironmentAtoms,
} from "@t3tools/client-runtime/peer/resources";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../../components/ui/AppText";
import { connectionAtomRuntime } from "../../../connection/runtime";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerSectionProps } from "../slotTypes";
const atoms = createResourcesEnvironmentAtoms(connectionAtomRuntime);
export function PeerHeldResources({ environmentId, status }: PeerSectionProps) {
  const [now, setNow] = useState(Date.now);
  const [clock, setClock] = useState({ slice: status.resources, at: now });
  if (clock.slice !== status.resources) setClock({ slice: status.resources, at: now });
  const observedAt = clock.slice === status.resources ? clock.at : now;
  useEffect(() => {
    const tick = () => {
      if (AppState.currentState === "active") setNow(Date.now());
    };
    const timer = setInterval(tick, 60_000);
    const listener = AppState.addEventListener("change", tick);
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, []);
  const rows = heldResources(status);
  const release = useAtomCommand(atoms.release, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function drop(h: (typeof rows)[number]) {
    setBusy(true);
    setError(null);
    try {
      const result = await release({ environmentId, input: releaseInput(h) });
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      setBusy(false);
    }
  }
  const ask = (h: (typeof rows)[number]) =>
    needsReleaseConfirmation(status, h)
      ? Alert.alert("Release this hold?", `${h.holder.email}’s agent holds ${resourceLabel(h)}.`, [
          { text: "Cancel", style: "cancel" },
          { text: "Release", style: "destructive", onPress: () => void drop(h) },
        ])
      : void drop(h);
  if (!rows.length) return null;
  return (
    <SettingsSection title="Held resources">
      <View className="gap-3 p-4">
        {rows.map((h) => (
          <View key={`${h.workspace}/${h.project}/${h.kind}/${h.name}`} className="gap-1">
            <Text className="text-foreground">{resourceLabel(h)}</Text>
            <Text className="text-sm text-foreground-muted">
              {h.project} · {h.holder.email === status.email ? "Your agent" : h.holder.email} ·{" "}
              {resourceTimeLeft(h, observedAt, Math.max(observedAt, now))}
            </Text>
            {h.intent ? <Text className="text-sm text-foreground-muted">“{h.intent}”</Text> : null}
            {mayRelease(status, h) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Release ${resourceLabel(h)}`}
                disabled={busy}
                onPress={() => ask(h)}
              >
                <Text className="text-primary">Release</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {error ? (
          <Text accessibilityRole="alert" className="text-foreground">
            {error}
          </Text>
        ) : null}
      </View>
    </SettingsSection>
  );
}
