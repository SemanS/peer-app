import { localCoordination } from "@t3tools/client-runtime/peer/local";
import { EnvironmentId, PEER_LOCAL_WORKSPACE, type PeerHubStatus } from "@t3tools/contracts";
import { useState } from "react";
import { CurrentContextReport } from "./CurrentContextReport";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SettingsSection } from "../settings/components/SettingsSection";

/** Mobile controls the connected environment's local engine, even while that environment is signed out of Hub. */
export function LocalWork({ status }: { readonly status: PeerHubStatus }) {
  const local = localCoordination(status);
  const [project, setProject] = useState<string | null>(null);
  const [shown, setShown] = useState(20);
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
        {local.projects.length === 0 ? null : (
          <View className="gap-2">
            <Text className="font-t3-semibold text-foreground">
              Shared contexts · {local.projects.length} projects
            </Text>
            {local.projects.slice(0, shown).map((entry) => (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                onPress={() => setProject(project === entry.id ? null : entry.id)}
                className="py-2"
              >
                <Text className="text-primary">
                  {project === entry.id ? "Hide shared contexts" : "Shared contexts and archive"}
                  {local.projects.length === 1 ? "" : ` · ${entry.id.slice(-6)}`}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {entry.contexts} saved contexts
                  {entry.gist === undefined ? "" : ` · ${entry.gist}`}
                </Text>
              </Pressable>
            ))}
            {shown >= local.projects.length ? null : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setShown(shown + 20)}
                className="py-2"
              >
                <Text className="text-primary">
                  More projects · {local.projects.length - shown}
                </Text>
              </Pressable>
            )}
          </View>
        )}
        {project === null ? null : (
          <CurrentContextReport
            key={project}
            environmentId={EnvironmentId.make(status.environmentId)}
            workspace={PEER_LOCAL_WORKSPACE}
            project={project}
            status={status}
            revision={local.contexts
              .filter((context) => context.project === project)
              .map((context) => `${context.scope}:${context.version}`)
              .join(":")}
          />
        )}
      </View>
    </SettingsSection>
  );
}
