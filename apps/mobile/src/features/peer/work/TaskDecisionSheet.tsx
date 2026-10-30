import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import type { WorkTaskNode } from "@t3tools/client-runtime/peer/work";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { MessageId, type EnvironmentId } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Alert, Linking, Modal, Pressable, View } from "react-native";
import { AppText, AppTextInput } from "../../../components/ui/AppText";
import { ScreenScrollView } from "../../../components/ui/ScreenScrollView";
import { uuidv4 } from "../../../lib/uuid";
import { useNavigationThreadShells } from "../../../state/entities";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { threadEnvironment } from "../../../state/threads";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useSavedRemoteConnection } from "../../../state/use-remote-environment-registry";
import { CurrentContextReport } from "../CurrentContextReport";
import { taskStateWords } from "./work.logic";
import { GitHubTaskPullRequests } from "../github/GitHubTaskPullRequests";
import { PeerHandoff } from "../handoff/PeerHandoff";
import { OpenSpecTaskPreparation } from "../openspec/OpenSpecTaskPreparation";
import { TaskRuns } from "./TaskRuns";

/** Task evidence and the existing review commands, accessible without leaving the phone. */
export function TaskDecisionSheet({
  environmentId,
  workspace,
  projectId,
  taskId,
  node,
  hosts,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly node: WorkTaskNode | undefined;
  readonly hosts: ReadonlyMap<string, EnvironmentId>;
  readonly onClose: () => void;
}) {
  const live = useEnvironmentQuery(serverEnvironment.peerHubLive({ environmentId, input: {} }));
  const status = live.data;
  const project = status?.workspaces
    .find((row) => row.slug === workspace)
    ?.projects.find((row) => row.project.id === projectId);
  const task = project?.work.tasks.find((row) => row.id === taskId);
  const connection = useSavedRemoteConnection(environmentId);
  const navigation = useNavigation();
  const shells = useNavigationThreadShells();
  const update = useAtomCommand(serverEnvironment.peerHubUpdateTask, { reportFailure: false });
  const prompt = useAtomCommand(serverEnvironment.peerHubPromptAgent, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const allowed = useAtomValue(serverEnvironment.peerHubUpdateTask.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const own = node?.threads
    .filter((row) => row.mine && !row.stale && row.open !== undefined && hosts.has(row.key))
    .sort((a, b) => Date.parse(b.activeAt ?? "0") - Date.parse(a.activeAt ?? "0"));
  const recipient =
    own?.find((row) => row.open?.kind === "thread") ??
    own?.find((row) => row.open?.kind === "herdr");
  const open = recipient?.open;
  const agentEnvironment =
    recipient === undefined ? environmentId : (hosts.get(recipient.key) ?? environmentId);
  const shell =
    open?.kind === "thread"
      ? shells.find((row) => row.environmentId === open.environmentId && row.id === open.threadId)
      : undefined;
  const canSend = open?.kind === "herdr" || (open?.kind === "thread" && shell !== undefined);
  const path = `/review/${encodeURIComponent(workspace)}/${encodeURIComponent(projectId)}/${encodeURIComponent(taskId)}`;
  let webUrl: string | null = null;
  if (connection !== null && !connection.relayManaged) {
    try {
      const base = new URL(connection.httpBaseUrl);
      if (base.protocol === "http:" || base.protocol === "https:")
        webUrl = new URL(path, base.origin).toString();
    } catch {
      /* A missing web origin leaves the exact route visible below. */
    }
  }
  const act = async (next: "done" | "open") => {
    if (inFlight.current || busy || !allowed || live.error !== null) return;
    if (next === "open" && note.trim() !== "" && !canSend) {
      setMessage(
        "Your agent is unavailable. Keep the note here, or clear it to reopen without sending a message.",
      );
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await update({
        environmentId,
        input: { workspace, projectId, taskId, status: next },
      });
      if (result._tag !== "Success") {
        setMessage(
          isAtomCommandInterrupted(result)
            ? "Task update was interrupted. Its outcome could not be confirmed."
            : String(squashAtomCommandFailure(result)),
        );
        return;
      }
      if (next === "done") {
        Alert.alert("Task complete", "Marked done. The team sees this task as complete.");
        setMessage("Marked done. The team sees this task as complete.");
        live.refresh();
        return;
      }
      if (note.trim() === "") {
        setMessage("Reopened for changes. No message was sent.");
        live.refresh();
        return;
      }
      const delivery =
        open?.kind === "thread" && shell !== undefined
          ? await startTurn({
              environmentId: open.environmentId,
              input: {
                threadId: open.threadId,
                message: {
                  messageId: MessageId.make(uuidv4()),
                  role: "user",
                  text: note.trim(),
                  attachments: [],
                },
                runtimeMode: shell.runtimeMode,
                interactionMode: shell.interactionMode,
                dispatchMode: "auto",
              },
            })
          : open?.kind === "herdr"
            ? await prompt({
                environmentId: agentEnvironment,
                input: { agentId: open.agentId, text: note.trim() },
              })
            : null;
      if (delivery?._tag === "Success") {
        setNote("");
        setMessage("Reopened for changes. Your agent received the note.");
      } else
        setMessage(
          "Reopened, but delivery of your note could not be confirmed. Your note is still here; check the chat before sending again.",
        );
      live.refresh();
    } catch (error) {
      setMessage(
        `The request could not be confirmed: ${error instanceof Error ? error.message : String(error)}. Your note is still here. Refresh the task before retrying.`,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      visible
      presentationStyle="pageSheet"
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 px-5 pt-6 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-1">
          <AppText accessibilityRole="header" className="text-xl font-t3-semibold">
            {task?.title ?? "Task details"}
          </AppText>
          <AppText className="text-sm text-foreground-muted">
            {workspace} · {project?.project.name ?? projectId} ·{" "}
            {node === undefined
              ? task?.status === "review"
                ? "In review"
                : task?.status === "done"
                  ? "Done"
                  : "Open"
              : taskStateWords(node)}
          </AppText>
        </View>
        {live.error === null ? null : (
          <AppText accessibilityRole="alert">Could not refresh this task: {live.error}</AppText>
        )}
        {status && project && task ? (
          <>
            <OpenSpecTaskPreparation
              environmentId={environmentId}
              label={connection?.environmentLabel ?? "Computer"}
              status={status}
              workspace={workspace}
              project={project}
              task={task}
            >
              {() => null}
            </OpenSpecTaskPreparation>
            <PeerHandoff
              environmentId={environmentId}
              label={connection?.environmentLabel ?? "Computer"}
              status={status}
              workspace={workspace}
              project={project}
              task={task}
              disabled={busy}
              onBusyChange={setBusy}
            />
            <GitHubTaskPullRequests
              environmentId={environmentId}
              label={connection?.environmentLabel ?? "Computer"}
              status={status}
              workspace={workspace}
              project={project}
              task={task}
              disabled={busy}
              onBusyChange={setBusy}
            />
            <TaskRuns
              environmentId={environmentId}
              status={status}
              workspace={workspace}
              project={project}
              taskId={taskId}
              revision={`${task.updatedAt}|${JSON.stringify(task.runs ?? null)}`}
            />
            <CurrentContextReport
              environmentId={environmentId}
              workspace={workspace}
              project={projectId}
              scope={`task:${taskId}`}
              revision={task.updatedAt}
              status={status}
            />
            <AppText accessibilityRole="header" className="font-t3-semibold">
              Decision
            </AppText>
            {!allowed ? (
              <AppText className="text-sm text-foreground-muted">
                This connection can read the task. Changing it requires operate access.
              </AppText>
            ) : null}
            {task.status !== "done" ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy || !allowed || live.error !== null}
                accessibilityState={{ disabled: busy || !allowed || live.error !== null }}
                className="min-h-12 justify-center rounded-xl border border-border p-3"
                onPress={() => void act("done")}
              >
                <AppText className="text-primary-text">
                  {busy ? "Saving…" : "Approve · mark done"}
                </AppText>
              </Pressable>
            ) : null}
            {task.status !== "open" ? (
              <>
                <AppText className="text-sm">Note for your agent (optional)</AppText>
                <AppTextInput
                  accessibilityLabel="Changes to request from your agent"
                  value={note}
                  onChangeText={setNote}
                  editable={!busy}
                  multiline
                  maxLength={8000}
                  className="min-h-24 rounded-xl border border-border p-3"
                />
                {!canSend ? (
                  <AppText className="text-sm text-foreground-muted">
                    No reachable personal agent is attached. You can reopen without a note, then
                    choose a chat to continue.
                  </AppText>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || !allowed || live.error !== null}
                  accessibilityState={{ disabled: busy || !allowed || live.error !== null }}
                  className="min-h-12 justify-center rounded-xl border border-border p-3"
                  onPress={() => void act("open")}
                >
                  <AppText className="text-primary-text">Request changes · reopen</AppText>
                </Pressable>
              </>
            ) : null}
            {open?.kind === "thread" ? (
              <Pressable
                accessibilityRole="button"
                className="min-h-11 justify-center"
                onPress={() => {
                  onClose();
                  navigation.navigate("Thread", {
                    environmentId: String(open.environmentId),
                    threadId: String(open.threadId),
                  });
                }}
              >
                <AppText className="text-primary-text">
                  Open chat · answer or approve agent requests
                </AppText>
              </Pressable>
            ) : open?.kind === "herdr" ? (
              <Pressable
                accessibilityRole="button"
                className="min-h-11 justify-center"
                onPress={() => {
                  onClose();
                  navigation.navigate("NeedsYouAgent", {
                    environmentId: String(agentEnvironment),
                    agentId: open.agentId,
                  });
                }}
              >
                <AppText className="text-primary-text">Open agent · send an answer</AppText>
              </Pressable>
            ) : null}
          </>
        ) : (
          <AppText accessibilityLiveRegion="polite">
            {live.isPending ? "Loading task…" : "This task is no longer available on this project."}
          </AppText>
        )}
        {message === null ? null : <AppText accessibilityLiveRegion="polite">{message}</AppText>}
        <AppText className="text-sm text-foreground-muted">
          Full repository diff review and brief editing are available on web or desktop.
        </AppText>
        {webUrl === null ? (
          <AppText selectable className="text-sm text-foreground-muted">
            Open this exact review on your computer: {path}
          </AppText>
        ) : (
          <Pressable
            accessibilityRole="link"
            className="min-h-11 justify-center"
            onPress={() => {
              void Linking.openURL(webUrl!).catch(() =>
                setMessage("Could not open the browser. Open this task’s review on your computer."),
              );
            }}
          >
            <AppText className="text-primary-text">Open this task’s full review on web</AppText>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          className="min-h-12 items-center justify-center rounded-xl border border-border"
          onPress={onClose}
        >
          <AppText>Close task details</AppText>
        </Pressable>
      </ScreenScrollView>
    </Modal>
  );
}
