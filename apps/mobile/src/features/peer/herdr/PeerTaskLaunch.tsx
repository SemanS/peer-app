import { peerAgentStartBlocker } from "@t3tools/client-runtime/peer/herdr";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Linking, Pressable, TextInput, View } from "react-native";
import { AppText as Text } from "../../../components/AppText";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { TaskLauncherProps } from "../slotTypes";

/** Starts a Claude Code or Codex agent on a task in its own checkout, or on a teammate's request. */
export function PeerTaskLaunch({
  environmentId,
  label,
  workspace,
  project,
  task,
  status,
  onBusyChange,
  disabled,
  request,
}: TaskLauncherProps) {
  const start = useAtomCommand(serverEnvironment.peerHubStartAgent, { reportFailure: false });
  const [harness, setHarness] = useState<"claude" | "codex">("claude");
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(
    request?.prompt ?? [task.key, task.title].filter(Boolean).join(": "),
  );
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = busy || disabled;
  const repositories = project.repositories.filter((repository) => repository.state === "ready");
  const repository =
    repositories.find((repository) => repository.id === repositoryId) ?? repositories[0];
  const blocked =
    peerAgentStartBlocker(status) ??
    (project.project.capacity.personal !== "any"
      ? "Use a Peer thread with an approved provider for this project's capacity policy."
      : null) ??
    (repository === undefined ? "Clone and open this project on the environment first." : null);
  const launch = async () => {
    if (pending || started || blocked !== null || repository === undefined || prompt.trim() === "")
      return;
    setBusy(true);
    onBusyChange(true);
    setMessage(null);
    try {
      const result = await start({
        environmentId,
        input: {
          ...(request === undefined ? {} : { requestId: request.id }),
          workspace,
          projectId: project.project.id,
          taskId: task.id,
          repositoryId: repository.id,
          harness,
          prompt: prompt.trim(),
        },
      });
      if (result._tag === "Success") {
        setStarted(true);
        setMessage(
          result.value.promptError ?? "Agent started in its own checkout on this environment.",
        );
      } else if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <SettingsSection
      title={request === undefined ? "Start agent on task" : "Accept request and start agent"}
    >
      <View className="gap-4 p-4">
        <Text className="font-t3-medium text-foreground">
          {[task.key, task.title].filter(Boolean).join(" · ")}
        </Text>
        <SegmentedControl
          options={[
            { value: "claude" as const, label: "Claude Code" },
            { value: "codex" as const, label: "Codex" },
          ]}
          selected={harness}
          onSelect={(value) => {
            if (!pending) setHarness(value);
          }}
        />
        {repositories.length > 1
          ? repositories.map((candidate) => (
              <Pressable
                key={candidate.id}
                accessibilityRole="button"
                disabled={pending}
                accessibilityState={{ selected: candidate.id === repository?.id }}
                onPress={() => setRepositoryId(candidate.id)}
                className="py-2"
              >
                <Text className="text-foreground">
                  {candidate.id === repository?.id ? "✓ " : ""}
                  {candidate.id}
                </Text>
              </Pressable>
            ))
          : null}
        <Text className="text-sm text-foreground-muted">First prompt</Text>
        <TextInput
          accessibilityLabel="First task prompt"
          value={prompt}
          onChangeText={setPrompt}
          editable={!pending}
          multiline
          maxLength={20_000}
          className="min-h-24 rounded-xl border border-border p-3 text-foreground"
          textAlignVertical="top"
        />
        <Text className="text-sm text-foreground-muted">
          Peer creates a feature branch in its own checkout. The agent uses its owner's CLI on{" "}
          {label}.
        </Text>
        {blocked === null ? null : <Text className="text-foreground-muted">{blocked}</Text>}
        {status.agents.herdr !== "running" ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL("https://herdr.dev/docs/install/")}
          >
            <Text className="py-2 text-primary-text">Install herdr on {label}</Text>
          </Pressable>
        ) : null}
        {message === null ? null : (
          <Text accessibilityRole="alert" className="text-foreground">
            {message}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            disabled: pending || started || blocked !== null || prompt.trim() === "",
          }}
          disabled={pending || started || blocked !== null || prompt.trim() === ""}
          className="items-center rounded-xl bg-primary p-3 disabled:opacity-50"
          onPress={() => void launch()}
        >
          <Text className="font-t3-medium text-primary-foreground">
            {busy
              ? "Starting…"
              : started
                ? "Started"
                : request === undefined
                  ? "Start agent"
                  : "Accept & start"}
          </Text>
        </Pressable>
      </View>
    </SettingsSection>
  );
}
