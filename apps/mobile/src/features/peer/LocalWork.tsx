import { localCoordination } from "@t3tools/client-runtime/peer/local";
import type { PeerHubStatus } from "@t3tools/contracts";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SettingsSection } from "../settings/components/SettingsSection";

/** Mobile controls the connected environment's local engine, even while that environment is signed out of Hub. */
export function LocalWork({ status }: { readonly status: PeerHubStatus }) {
  const local = localCoordination(status);
  return (
    <SettingsSection title={local.title}>
      <View className="gap-3 p-4">
        <Text className="text-foreground-muted">{local.description}</Text>
        {local.available ? (
          <>
            <Text className="text-foreground">
              {local.sessions.length} agents · {local.open} open overlaps · {local.resolved}{" "}
              resolved
            </Text>
            {local.providers.map((provider) => (
              <Text key={provider.name} className="text-foreground-muted">
                {provider.name}: {provider.ready ? "hooks ready" : "setup needed or paused"}
              </Text>
            ))}
            {local.overlaps.slice(0, 8).map((overlap) => (
              <View key={overlap.id} className="gap-1">
                <Text className="font-t3-semibold text-foreground">
                  {overlap.state === "open" ? "Overlap detected" : "Overlap resolved"}:{" "}
                  {overlap.files.join(", ")}
                </Text>
                <Text className="text-foreground-muted">
                  {overlap.sessions
                    .map((id) => local.sessions.find((s) => s.id === id)?.label ?? id)
                    .join(" ↔ ")}
                </Text>
                {overlap.resolution === undefined ? null : (
                  <Text className="text-foreground-muted">{overlap.resolution}</Text>
                )}
                {overlap.notes.slice(-2).map((note) => (
                  <Text key={note.id} className="text-foreground-muted">
                    {note.text}
                  </Text>
                ))}
              </View>
            ))}
            {local.overlaps.length === 0 ? (
              <Text className="text-foreground-muted">No overlaps recorded yet.</Text>
            ) : null}
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}
