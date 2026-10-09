import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { requestActionState, type NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";
import { AppText } from "../../../components/AppText";
import { MaterialListRow } from "../../../components/MaterialListRow";
import { ScreenScrollView } from "../../../components/ScreenScrollView";
import { showConfirmDialog } from "../../../components/ConfirmDialogHost";
import { environmentSession } from "../../../state/session";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import {
  squashAtomCommandFailure,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import { PeerTaskLaunch } from "../herdr/PeerTaskLaunch";
type RequestItem = Extract<NeedsYouItem, { kind: "request" }>;
function ComputerChoice({
  computer,
  selected,
  onChoose,
}: {
  computer: RequestItem["computers"][number];
  selected: boolean;
  onChoose: () => void;
}) {
  const session = useAtomValue(environmentSession.sessionStateValueAtom(computer.environmentId));
  const blocker =
    computer.blocker ??
    (!session?.scopes?.includes(AuthOrchestrationOperateScope)
      ? "This pairing cannot start an agent."
      : null);
  return (
    <MaterialListRow
      title={computer.label}
      subtitle={blocker ?? "Ready to accept and start"}
      disabled={blocker !== null}
      accessibilityState={{ selected, disabled: blocker !== null }}
      onPress={onChoose}
    />
  );
}
export function NeedsYouRequestSheet({
  item,
  onClose,
}: {
  item: RequestItem;
  onClose: () => void;
}) {
  const action = requestActionState(item),
    [environmentId, setEnvironmentId] = useState<EnvironmentId>(
      action.ready[0]?.environmentId ?? item.environmentId,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId)),
    allowed = session?.scopes?.includes(AuthOrchestrationOperateScope) === true;
  const query = useEnvironmentQuery(serverEnvironment.peerHubLive({ environmentId, input: {} })),
    status = query.data;
  const current = status?.requests?.find(
    (row) => row.workspace === item.workspace && row.request.id === item.request.id,
  )?.request;
  const project = status?.workspaces
      .find((workspace) => workspace.slug === item.workspace)
      ?.projects.find((project) => project.project.id === item.request.project),
    task = project?.work.tasks.find((task) => task.id === item.request.task);
  const dismiss = useAtomCommand(serverEnvironment.peerHubDismissRequest, { reportFailure: false });
  const dismissNow = () => {
    setBusy(true);
    setError(null);
    void dismiss({
      environmentId,
      input: {
        workspace: item.workspace,
        projectId: item.request.project,
        requestId: item.request.id,
      },
    })
      .then((result) => {
        if (result._tag === "Success") onClose();
        else if (!isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => setBusy(false));
  };
  const computer = item.computers.find((computer) => computer.environmentId === environmentId);
  const outcome =
    current?.status === "accepted"
      ? "accepted"
      : current && current.status !== "pending"
        ? "no-longer-pending"
        : undefined;
  return (
    <Modal visible presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 pt-6 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        <AppText accessibilityRole="header" className="text-xl font-t3-semibold">
          Review request
        </AppText>
        <AppText className="font-t3-medium">{item.title}</AppText>
        <AppText className="text-sm text-foreground-muted">
          {item.request.sender} · {item.workspace}
        </AppText>
        <View className="overflow-hidden rounded-xl">
          {item.computers.map((computer) => (
            <ComputerChoice
              key={computer.environmentId}
              computer={computer}
              selected={computer.environmentId === environmentId}
              onChoose={() => !busy && setEnvironmentId(computer.environmentId)}
            />
          ))}
        </View>
        {query.error ? <AppText accessibilityRole="alert">{query.error}</AppText> : null}
        {outcome ? (
          <AppText accessibilityLiveRegion="polite">
            {requestActionState(item, outcome).message}
          </AppText>
        ) : status && project && task ? (
          <PeerTaskLaunch
            environmentId={environmentId}
            label={computer?.label ?? "Computer"}
            workspace={item.workspace}
            project={project}
            task={task}
            status={status}
            disabled={
              busy ||
              !allowed ||
              computer?.blocker !== null ||
              current === undefined ||
              query.error !== null
            }
            onBusyChange={setBusy}
            request={current ?? item.request}
          />
        ) : (
          <AppText>Loading the task…</AppText>
        )}
        {!allowed ? (
          <AppText className="text-sm text-foreground-muted">
            This pairing cannot operate on this computer.
          </AppText>
        ) : null}
        {outcome === undefined ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy || !allowed || !computer?.connected || query.error !== null}
            onPress={() =>
              showConfirmDialog({
                title: "Dismiss request?",
                message: item.title,
                confirmText: "Dismiss",
                destructive: true,
                onConfirm: dismissNow,
              })
            }
          >
            <AppText className="text-destructive">Dismiss</AppText>
          </Pressable>
        ) : null}
        {error ? <AppText accessibilityRole="alert">{error}</AppText> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={onClose}>
          <AppText className="text-primary">Close</AppText>
        </Pressable>
      </ScreenScrollView>
    </Modal>
  );
}
