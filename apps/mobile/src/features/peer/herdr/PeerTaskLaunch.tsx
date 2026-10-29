import { requestStartInput } from "@t3tools/client-runtime/peer/requests";
import { herdrNeedsInstall, peerLaunchBlocker } from "@t3tools/client-runtime/peer/herdr";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Linking, Pressable, TextInput, View, ScrollView } from "react-native";
import { AppText as Text } from "../../../components/ui/AppText";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { TaskLauncherProps, TaskPreparationState } from "../slotTypes";
import { settleTaskInput, taskLaunchPrompt, type TaskSettlement } from "../work/taskTree.logic";
import { herdrLaunchCheckoutText, herdrLaunchVcs } from "./herdrRuntime.logic";

/** Starts a Claude Code or Codex agent on a task in its own checkout, or on a teammate's request. */
export function PeerTaskLaunch(props: TaskLauncherProps) {
  const scope = JSON.stringify([
    props.environmentId,
    props.status.email,
    props.workspace,
    props.project.project.id,
    props.task.id,
    props.request?.id,
  ]);
  return <ScopedPeerTaskLaunch key={scope} {...props} />;
}

function ScopedPeerTaskLaunch({
  environmentId,
  label,
  workspace,
  project,
  task,
  status,
  onBusyChange,
  disabled,
  request,
  onRequestOutcome,
  taskPreparation: Preparation,
  workProject,
}: TaskLauncherProps) {
  const start = useAtomCommand(serverEnvironment.peerHubStartAgent, { reportFailure: false });
  const [harness, setHarness] = useState<"claude" | "codex">("claude");
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [editedPrompt, setPrompt] = useState<{ repositoryId: string; text: string } | null>(null);
  const update = useAtomCommand(serverEnvironment.peerHubUpdateTask, { reportFailure: false });
  // An unsettled item is never started: the person says first whether it runs as one task.
  const unsettled =
    request === undefined &&
    workProject?.areas.some((area) =>
      area.tasks.some((row) => row.id === task.id && row.unsettled === true),
    ) === true;
  const defaultPrompt =
    request === undefined
      ? taskLaunchPrompt(workProject, task)
      : `${[task.key, task.title].filter(Boolean).join(": ")}.`.slice(0, 2_000);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = busy || disabled;
  const repositories = project.repositories.filter((repository) => repository.state === "ready");
  const repository =
    repositories.find((repository) => repository.id === repositoryId) ?? repositories[0];
  const blocked = peerLaunchBlocker(status, project);
  const render = (preparation: TaskPreparationState | undefined) => {
    const prompt =
      (editedPrompt?.repositoryId === repository?.id ? editedPrompt?.text : undefined) ??
      (preparation === undefined
        ? defaultPrompt
        : preparation.state === "ready"
          ? preparation.prompt
          : "");
    const preparing =
      preparation !== undefined &&
      (preparation.state !== "ready" || preparation.repositoryId !== repository?.id);
    const launch = async () => {
      if (
        pending ||
        preparing ||
        started ||
        blocked !== null ||
        repository === undefined ||
        prompt.trim() === ""
      )
        return;
      setBusy(true);
      onBusyChange(true);
      setMessage(null);
      try {
        const result = await start({
          environmentId,
          input: {
            ...(request === undefined ? { prompt } : requestStartInput(request, prompt)),
            workspace,
            projectId: project.project.id,
            taskId: task.id,
            repositoryId: repository.id,
            harness,
          },
        });
        if (result._tag === "Success") {
          setStarted(true);
          if (request)
            onRequestOutcome?.(result.value.promptError ? "start-not-confirmed" : "accepted");
          setMessage(
            result.value.promptError ?? "Agent started in its own checkout on this environment.",
          );
        } else if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          if (request) onRequestOutcome?.("start-not-confirmed");
          setMessage(error instanceof Error ? error.message : String(error));
        }
      } finally {
        setBusy(false);
        onBusyChange(false);
      }
    };
    const settle = async (choice: TaskSettlement) => {
      if (pending) return;
      setBusy(true);
      onBusyChange(true);
      setMessage(null);
      try {
        const result = await update({
          environmentId,
          input: settleTaskInput(
            { workspace, projectId: project.project.id, taskId: task.id },
            choice,
          ),
        });
        if (result._tag === "Success") {
          setMessage(
            choice === "one"
              ? "It runs as one task now. Start an agent on it."
              : "It runs by its parts now. Start an agent on its open items.",
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
          {request === undefined ? null : (
            <ScrollView
              className="max-h-64 rounded-xl border border-border p-3"
              nestedScrollEnabled
            >
              <Text className="text-sm text-foreground-muted">
                {request.sender}
                {request.expiresAt === undefined ? null : ` · Expires on ${request.expiresAt}`}
              </Text>
              <Text className="font-t3-medium text-foreground">{request.title}</Text>
              <Text selectable className="mt-2 text-foreground">
                {request.prompt}
              </Text>
            </ScrollView>
          )}
          <Text className="text-sm text-foreground-muted">
            {request === undefined ? "First prompt" : "Your instruction"}
          </Text>
          <TextInput
            accessibilityLabel={request === undefined ? "First task prompt" : "Your instruction"}
            value={prompt}
            onChangeText={(text) => {
              if (repository !== undefined) setPrompt({ repositoryId: repository.id, text });
            }}
            editable={!pending}
            multiline
            maxLength={request === undefined ? 20_000 : 2_000}
            className="min-h-24 rounded-xl border border-border p-3 text-foreground"
            textAlignVertical="top"
          />
          <Text className="text-sm text-foreground-muted">
            {herdrLaunchCheckoutText(herdrLaunchVcs(repository, repositories), label)}
          </Text>
          {blocked === null ? null : <Text className="text-foreground-muted">{blocked}</Text>}
          {herdrNeedsInstall(status) ? (
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
          {unsettled ? (
            <View className="gap-2">
              <Text className="text-foreground">
                Run it as one task, or by its parts? Decide before an agent starts on it.
              </Text>
              <View className="flex-row gap-2">
                {(
                  [
                    { choice: "one", label: "One task" },
                    { choice: "parts", label: "Its parts" },
                  ] as const
                ).map(({ choice, label: text }) => (
                  <Pressable
                    key={choice}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: pending }}
                    disabled={pending}
                    className="flex-1 items-center rounded-xl border border-border p-3 disabled:opacity-50"
                    onPress={() => void settle(choice)}
                  >
                    <Text className="font-t3-medium text-foreground">{text}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled:
                  pending ||
                  preparing ||
                  started ||
                  blocked !== null ||
                  repository === undefined ||
                  prompt.trim() === "",
              }}
              disabled={
                pending ||
                preparing ||
                started ||
                blocked !== null ||
                repository === undefined ||
                prompt.trim() === ""
              }
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
          )}
        </View>
      </SettingsSection>
    );
  };
  return Preparation === undefined || request !== undefined ? (
    render(undefined)
  ) : (
    <Preparation
      environmentId={environmentId}
      label={label}
      workspace={workspace}
      project={project}
      task={task}
      status={status}
      repositoryId={repository?.id}
    >
      {render}
    </Preparation>
  );
}
