import {
  AuthOrchestrationOperateScope,
  PEER_REQUEST_REASON_MAX,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, View } from "react-native";
import {
  personName,
  requestActionState,
  requestSheetOutcome,
  type NeedsYouItem,
} from "@t3tools/client-runtime/peer/needs-you";
import { AppText, AppTextInput } from "../../../components/ui/AppText";
import { NavigationRow } from "../../../components/ui/NavigationRow";
import { ScreenScrollView } from "../../../components/ui/ScreenScrollView";
import { environmentSession } from "../../../state/session";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import {
  squashAtomCommandFailure,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import { CurrentContextReport } from "../CurrentContextReport";
import { PeerTaskLaunch } from "../herdr/PeerTaskLaunch";
import { declineRequestInput } from "./needsYou.logic";
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
    <NavigationRow
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
  const [launchOutcome, setLaunchOutcome] = useState<"accepted" | "start-not-confirmed" | null>(
    null,
  );
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
  // Declining asks for an optional reason the sender sees; a failed attempt keeps the text.
  const [declining, setDeclining] = useState(false),
    [reason, setReason] = useState("");
  const sender = status
    ? personName(status, item.workspace, item.request.sender)
    : item.request.sender;
  const declineNow = () => {
    setBusy(true);
    setError(null);
    void dismiss({ environmentId, input: declineRequestInput(item, reason) })
      .then((result) => {
        if (result._tag === "Success") {
          Alert.alert("Request declined", "The sender can see your decision and reason.");
          onClose();
        } else if (isAtomCommandInterrupted(result))
          setError(
            "The decision was interrupted. Its outcome could not be confirmed. Your reason is still here.",
          );
        else {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => setBusy(false));
  };
  const computer = item.computers.find((computer) => computer.environmentId === environmentId);
  const outcome = requestSheetOutcome(current?.status, busy, launchOutcome);
  const cannotDecline = busy || !allowed || !computer?.connected || query.error !== null;
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
        {status && project && task ? (
          <CurrentContextReport
            environmentId={environmentId}
            workspace={item.workspace}
            project={project.project.id}
            scope={`task:${task.id}`}
            revision={task.updatedAt}
            status={status}
          />
        ) : null}
        {outcome ? (
          <AppText accessibilityLiveRegion="polite">
            {requestActionState(item, outcome).message}
          </AppText>
        ) : declining ? (
          <View className="gap-3">
            <View className="gap-1 rounded-xl border border-peer-team-border bg-peer-team p-3">
              <AppText className="text-xs font-t3-medium text-peer-team-foreground">
                {sender} wrote
              </AppText>
              <ScrollView className="max-h-48" nestedScrollEnabled>
                <AppText selectable className="text-sm">
                  {item.request.prompt}
                </AppText>
              </ScrollView>
            </View>
            <View className="flex-row items-baseline justify-between gap-3">
              <AppText className="min-w-0 flex-1 text-sm">
                Tell {sender} why (optional). {sender} sees exactly this.
              </AppText>
              <AppText className="text-xs text-foreground-muted">
                {reason.length}/{PEER_REQUEST_REASON_MAX}
              </AppText>
            </View>
            <AppTextInput
              accessibilityLabel={`Why you decline, for ${sender}`}
              autoFocus
              multiline
              maxLength={PEER_REQUEST_REASON_MAX}
              value={reason}
              onChangeText={setReason}
              editable={!busy}
              textAlignVertical="top"
              className="min-h-24"
            />
            <AppText className="text-sm text-foreground-muted">
              The request closes for both of you. Nothing runs on your computer.
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: cannotDecline }}
              disabled={cannotDecline}
              onPress={declineNow}
              className="items-center rounded-xl border border-danger-border bg-danger p-3 disabled:opacity-50"
            >
              <AppText className="font-t3-medium text-danger-foreground">
                {busy ? "Declining…" : "Decline request"}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setDeclining(false)}
            >
              <AppText className="text-primary-text">Cancel</AppText>
            </Pressable>
          </View>
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
            onRequestOutcome={setLaunchOutcome}
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
        {outcome === undefined && !declining ? (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Asks for an optional reason the sender sees"
            disabled={cannotDecline}
            onPress={() => setDeclining(true)}
          >
            <AppText className="text-danger-foreground">Decline…</AppText>
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
