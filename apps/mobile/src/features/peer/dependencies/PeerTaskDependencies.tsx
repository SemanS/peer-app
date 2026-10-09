import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../../components/AppText";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  candidates,
  cycleSentence,
  dependenciesOf,
  neededBy,
  dependencyName,
  projectDependencyIndex,
  stateWord,
} from "@t3tools/client-runtime/peer/dependencies";
import type { PeerTaskProps } from "../slotTypes";
import { blockedNote } from "./blockedNote";
export function DependencyBadge(props: PeerTaskProps) {
  const text = blockedNote(props);
  return text ? <Text className="text-foreground-muted">{text}</Text> : null;
}
export function PeerTaskDependencies({
  environmentId,
  status,
  workspace,
  project,
  task,
  disabled,
  onBusyChange,
}: PeerTaskProps) {
  const command = useAtomCommand(serverEnvironment.peerDependenciesChange, {
      reportFailure: false,
    }),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const snapshot = status.dependencies?.find((s) => s.workspace === workspace);
  if (!snapshot?.available) return null;
  const index = projectDependencyIndex(project),
    on = dependenciesOf(snapshot, project.project.id, task.id, index),
    needed = neededBy(snapshot, project.project.id, task.id, index);
  const change = async (id: string, remove: boolean) => {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const result = await command({
        environmentId,
        input: {
          workspace,
          projectId: project.project.id,
          taskId: task.id,
          ...(remove ? { remove: [id] } : { add: [id] }),
        },
      });
      if (result._tag === "Success") {
        if (result.value.kind === "cycle") setError(cycleSentence(result.value.path, index));
      } else {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <View className="gap-2">
      <Text className="font-t3-medium text-foreground">Depends on</Text>
      {on.length ? (
        on.map(({ task: other, state }) => (
          <View key={other.id} className="flex-row items-center gap-2">
            <Text className="text-foreground">
              {dependencyName(other)} · {stateWord(state)}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy || disabled}
              onPress={() => void change(other.id, true)}
            >
              <Text className="text-primary">Remove</Text>
            </Pressable>
          </View>
        ))
      ) : (
        <Text className="text-foreground-muted">None</Text>
      )}
      <Text className="font-t3-medium text-foreground">Add dependency</Text>
      {candidates(snapshot, project.project.id, task.id, index)
        .filter((choice) => !choice.checked)
        .map(({ task: other, state }) => (
          <Pressable
            key={other.id}
            accessibilityRole="button"
            disabled={busy || disabled}
            onPress={() => void change(other.id, false)}
          >
            <Text className="text-primary">
              {dependencyName(other)} · {stateWord(state)}
            </Text>
          </Pressable>
        ))}
      <Text className="text-foreground-muted">
        Needed by: {needed.map(({ task: other }) => dependencyName(other)).join(", ") || "None"}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
