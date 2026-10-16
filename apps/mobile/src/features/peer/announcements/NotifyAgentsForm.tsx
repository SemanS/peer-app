import { useState } from "react";
import { Pressable, TextInput, View, Switch } from "react-native";
import {
  announcementCharacterCount,
  announcementDraftError,
  announcementReach,
  announcementReachLine,
  editAnnouncementDraft,
  newAnnouncementDraft,
  type AnnouncementDraft,
} from "@t3tools/client-runtime/peer/announcements";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PeerHubStatus, PeerTask } from "@t3tools/contracts";
import { AppText as Text } from "../../../components/ui/AppText";
import { useAtomCommand } from "../../../state/use-atom-command";
import { announcementAtoms } from "./atoms";
import { randomUUID } from "expo-crypto";
export function NotifyAgentsForm({
  environmentId,
  status,
  workspace,
  project,
  tasks,
  onPosted,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: string;
  readonly tasks: ReadonlyArray<PeerTask>;
  readonly onPosted: () => void;
}) {
  const [draft, setDraft] = useState(() => newAnnouncementDraft(randomUUID()));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const post = useAtomCommand(announcementAtoms.post, { reportFailure: false });
  const edit = (patch: Partial<AnnouncementDraft>) => {
    setDraft((d) => editAnnouncementDraft(d, patch, randomUUID()));
    setMessage(null);
  };
  async function send() {
    const invalid = announcementDraftError(draft);
    if (invalid) {
      setMessage(invalid);
      return;
    }
    setBusy(true);
    try {
      const result = await post({ environmentId, input: { workspace, project, ...draft } });
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        setMessage(failure instanceof Error ? failure.message : String(failure));
      } else {
        setDraft(newAnnouncementDraft(randomUUID()));
        setMessage("Announcement posted. Agents hear it at their next step.");
        onPosted();
      }
    } finally {
      setBusy(false);
    }
  }
  const reach = announcementReach(
    (status.coordination?.sessions ?? []).filter((s) => s.workspace === workspace),
    project,
    draft.task,
  );
  return (
    <View className="gap-3">
      <Text className="font-t3-medium text-foreground">Notify agents</Text>
      <TextInput
        accessibilityLabel="Announcement message"
        multiline
        editable={!busy}
        value={draft.text}
        onChangeText={(text) => edit({ text })}
        placeholder="Information for the project’s agents"
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <Text className="text-sm text-foreground-muted">
        {announcementCharacterCount(draft.text)}/300 characters
      </Text>
      <Text className="text-foreground">Applies to</Text>
      <View className="flex-row flex-wrap gap-3">
        {[{ id: "", title: "Whole project" }, ...tasks.filter((t) => t.status !== "done")].map(
          (task) => (
            <Pressable
              key={task.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: (draft.task ?? "") === task.id, disabled: busy }}
              disabled={busy}
              onPress={() => edit({ task: task.id || undefined })}
            >
              <Text className="text-primary">
                {(draft.task ?? "") === task.id ? "● " : "○ "}
                {task.title}
              </Text>
            </Pressable>
          ),
        )}
      </View>
      <Text className="text-foreground">Valid for</Text>
      <View className="flex-row flex-wrap gap-3">
        {[
          [60, "1 hour"],
          [240, "4 hours"],
          [1440, "24 hours"],
          [4320, "3 days"],
        ].map(([minutes, label]) => (
          <Pressable
            key={minutes}
            accessibilityRole="radio"
            accessibilityState={{ checked: draft.validForMinutes === minutes, disabled: busy }}
            disabled={busy}
            onPress={() => edit({ validForMinutes: Number(minutes) })}
          >
            <Text className="text-primary">
              {draft.validForMinutes === minutes ? "● " : "○ "}
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="text-foreground">Wake idle agents</Text>
        <Switch
          accessibilityLabel="Wake idle agents"
          value={draft.wake}
          disabled={busy}
          onValueChange={(wake) => edit({ wake })}
        />
      </View>
      <Text className="text-sm text-foreground-muted">{announcementReachLine(reach)}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy || announcementDraftError(draft) !== null}
        onPress={() => void send()}
        className="py-2"
      >
        <Text className="text-primary">{busy ? "Posting…" : "Notify agents"}</Text>
      </Pressable>
      {message ? (
        <Text accessibilityRole="alert" className="text-foreground">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
