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
import { AppText } from "../../../components/ui/AppText";
import * as Dialog from "../../../components/ui/Dialog";
import { serverEnvironment } from "../../../state/server";
import { environmentSession } from "../../../state/session";
import { useAtomCommand } from "../../../state/use-atom-command";
import {
  squashAtomCommandFailure,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import { CurrentContextReport } from "../CurrentContextReport";
import { OwnerCallCard } from "../ownership/OwnerCallCard";
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
  const [outcome, setOutcome] = useState<string | null>(null);
  const scope = {
    workspace: item.overlap.workspace,
    project: item.overlap.project,
    overlap: item.overlap.id,
  };
  const act = (close: boolean, message?: string) => {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
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
        if (result._tag === "Success")
          setOutcome(
            close
              ? "Overlap closed. Both agents can see the resolution."
              : "Agreement requested. Both agents can see your request.",
          );
        else if (isAtomCommandInterrupted(result))
          setError("The request was interrupted. Its outcome could not be confirmed.");
        else {
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
        className="min-h-11 justify-center"
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
        className="min-h-11 justify-center"
        disabled={busy || availability.disabled}
        onPress={() =>
          Dialog.prompt({
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
        className="min-h-11 justify-center"
        disabled={busy || availability.disabled}
        onPress={() =>
          Dialog.confirm({
            title: "Close this overlap?",
            message: "The agents will see that you closed it.",
            confirmText: "Close it yourself",
            onConfirm: () => act(true),
          })
        }
      >
        <AppText className="text-primary">Close it yourself</AppText>
      </Pressable>
      {outcome === null ? null : <AppText accessibilityLiveRegion="polite">{outcome}</AppText>}
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
  onTask,
}: {
  item: NeedsYouItem;
  environments: ReadonlyArray<NeedsYouEnvironment>;
  focused: boolean;
  onRequest: (item: Extract<NeedsYouItem, { kind: "request" }>) => void;
  onTask?: (() => void) | undefined;
}) {
  const context = item.kind === "stale" && item.open?.kind === "context" ? item.open : null;
  const [showContext, setShowContext] = useState(false);
  const copy = needsYouCardCopy(item),
    navigation = useNavigation();
  // An owner's call has its own card and sheet: Decide, with a note, rather than Open.
  if (item.kind === "owner-call") {
    return <OwnerCallCard item={item} environments={environments} focused={focused} />;
  }
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
      {onTask === undefined ? null : (
        <Pressable accessibilityRole="button" className="min-h-11 justify-center" onPress={onTask}>
          <AppText className="text-primary-text">Review task brief, result and evidence</AppText>
        </Pressable>
      )}
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
          {context !== null ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showContext }}
                className="min-h-11 justify-center"
                onPress={() => setShowContext(!showContext)}
              >
                <AppText className="text-primary-text">
                  {showContext ? "Hide input evidence" : "Inspect changed inputs and evidence"}
                </AppText>
              </Pressable>
              {showContext ? (
                <CurrentContextReport
                  environmentId={context.environmentId}
                  workspace={context.workspace}
                  project={context.project}
                  scope={context.scope}
                  revision={item.stale.scopes
                    .map((scope) => `${scope.scope}:${scope.currentVersion}`)
                    .join(":")}
                  status={
                    environments.find(
                      (environment) => environment.environmentId === context.environmentId,
                    )?.status ?? null
                  }
                />
              ) : null}
            </>
          ) : (
            <AppText className="text-sm text-foreground-muted">
              The original task context is no longer available from this notification.
            </AppText>
          )}
        </>
      ) : item.kind === "overlap" ? (
        <OverlapActions item={item} environments={environments} />
      ) : (
        <Pressable
          accessibilityRole="button"
          className="min-h-11 justify-center"
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
