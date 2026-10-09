import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { memo, useState } from "react";
import { Pressable, View } from "react-native";
import { AuthOrchestrationOperateScope, PERSON_OVERLAP_RESOLUTION } from "@t3tools/contracts";
import {
  needsYouCardCopy,
  overlapActionAvailability,
  type NeedsYouEnvironment,
  type NeedsYouItem,
} from "@t3tools/client-runtime/peer/needs-you";
import { AppText } from "../../../components/AppText";
import { showConfirmDialog, showTextInputDialog } from "../../../components/ConfirmDialogHost";
import { serverEnvironment } from "../../../state/server";
import { environmentSession } from "../../../state/session";
import { useAtomCommand } from "../../../state/use-atom-command";
import {
  squashAtomCommandFailure,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
function OverlapActions({
  item,
  environments,
}: {
  item: Extract<NeedsYouItem, { kind: "overlap" }>;
  environments: ReadonlyArray<NeedsYouEnvironment>;
}) {
  const environment =
    environments.find((environment) =>
      item.computers.some(
        (computer) =>
          computer.environmentId === environment.environmentId &&
          computer.connected &&
          computer.blocker === null,
      ),
    ) ?? environments.find((environment) => environment.environmentId === item.environmentId);
  const environmentId = environment?.environmentId ?? item.environmentId;
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId));
  const availability = overlapActionAvailability({
    connected: environment?.connected ?? false,
    coordination: environment?.status?.coordination.enabled ?? false,
    hubError: environment?.status?.error != null,
    canOperate: session?.scopes?.includes(AuthOrchestrationOperateScope) === true,
  });
  const settle = useAtomCommand(serverEnvironment.peerHubSettleOverlap, { reportFailure: false }),
    resolve = useAtomCommand(serverEnvironment.peerHubResolveOverlap, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const scope = {
    workspace: item.overlap.workspace,
    project: item.overlap.project,
    overlap: item.overlap.id,
  };
  const act = (close: boolean, message?: string) => {
    setBusy(true);
    setError(null);
    void (
      close
        ? resolve({ environmentId, input: { ...scope, resolution: PERSON_OVERLAP_RESOLUTION } })
        : settle({
            environmentId,
            input: { ...scope, ...(message?.trim() ? { message: message.trim() } : {}) },
          })
    )
      .then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => setBusy(false));
  };
  return (
    <View className="gap-2">
      {availability.reason ? (
        <AppText className="text-sm text-foreground-muted">{availability.reason}</AppText>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || availability.disabled }}
        disabled={busy || availability.disabled}
        onPress={() => act(false)}
      >
        <AppText className="text-primary">
          {item.phase === "unanswered" ? "Ask again" : "Request agreement"}
        </AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy || availability.disabled}
        onPress={() =>
          showTextInputDialog({
            title: "Message for both agents (optional)",
            initialValue: "",
            confirmText: "Request agreement",
            onConfirm: (message) => act(false, message),
          })
        }
      >
        <AppText className="text-primary">Add a message</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy || availability.disabled}
        onPress={() =>
          showConfirmDialog({
            title: "Close this overlap?",
            message: "The agents will see that you closed it.",
            confirmText: "Close it yourself",
            onConfirm: () => act(true),
          })
        }
      >
        <AppText className="text-primary">Close it yourself</AppText>
      </Pressable>
      {error ? (
        <AppText accessibilityRole="alert" className="text-destructive">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
export const NeedsYouCard = memo(function NeedsYouCard({
  item,
  environments,
  focused,
  onRequest,
}: {
  item: NeedsYouItem;
  environments: ReadonlyArray<NeedsYouEnvironment>;
  focused: boolean;
  onRequest: (item: Extract<NeedsYouItem, { kind: "request" }>) => void;
}) {
  const copy = needsYouCardCopy(item),
    navigation = useNavigation();
  const open = () => {
    if (item.kind === "request") onRequest(item);
    else if (item.kind === "thread")
      navigation.navigate("Thread", {
        environmentId: String(item.environmentId),
        threadId: String(item.thread.id),
      });
    else if (item.kind === "agent")
      navigation.navigate("NeedsYouAgent", {
        environmentId: String(item.environmentId),
        agentId: item.agent.id,
      });
  };
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={[
        copy.label,
        item.title,
        item.environmentLabel,
        item.offline ? "Offline" : "",
      ]
        .filter(Boolean)
        .join(", ")}
      className={`gap-2 rounded-xl border p-4 ${focused ? "border-primary bg-card" : "border-border bg-card"}`}
    >
      <AppText className="text-xs font-t3-medium text-foreground-muted">
        {copy.label} · {item.environmentLabel}
        {item.offline ? " · Offline" : ""}
      </AppText>
      <AppText accessibilityRole="header" className="text-base font-t3-semibold">
        {item.title}
      </AppText>
      <AppText className="text-sm text-foreground-muted">{copy.guidance}</AppText>
      {item.hubError ? (
        <AppText accessibilityRole="alert" className="text-sm text-foreground-muted">
          The Peer Hub is unreachable. Reconnect before changing this item.
        </AppText>
      ) : null}
      {item.kind === "stale" ? (
        <>
          <View className="gap-1">
            {item.stale.scopes.map((scope) => (
              <AppText key={scope.scope} className="text-sm">
                {scope.scope}: version {scope.readVersion} →{" "}
                {scope.currentVersion === null ? "removed" : `version ${scope.currentVersion}`}
              </AppText>
            ))}
          </View>
          <AppText className="text-sm text-foreground-muted">
            Open the task context on web or desktop to inspect these inputs.
          </AppText>
        </>
      ) : item.kind === "overlap" ? (
        <OverlapActions item={item} environments={environments} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: item.offline }}
          disabled={item.offline}
          onPress={open}
        >
          <AppText className="text-primary">
            {item.kind === "request" ? "Review request" : "Open"}
          </AppText>
        </Pressable>
      )}
    </View>
  );
});
