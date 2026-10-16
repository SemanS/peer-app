import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { PeerOwnershipDecision } from "@t3tools/contracts";
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";

import { AppText, AppTextInput } from "../../../components/ui/AppText";
import { ScreenScrollView } from "../../../components/ui/ScreenScrollView";
import { cn } from "../../../lib/cn";
import { serverEnvironment } from "../../../state/server";
import { environmentSession } from "../../../state/session";
import { useAtomCommand } from "../../../state/use-atom-command";
import {
  DECIDE_ON_YOUR_COMPUTER,
  canDecide,
  clampNote,
  noteCounter,
  ownerCallContext,
  ownerCallControls,
  ownerCallDecision,
  ownerCallSheetText,
  type OwnerCallEnvironment,
  type OwnerCallItem,
} from "./ownerCall.logic";
import { useMinuteClock } from "./useMinuteClock";

/**
 * Deciding an owner's call: the call in full, an optional note for the asking agent, and Accept or
 * Decline. The owner decides; a lead decides for an owner who left, and the buttons name them.
 * Deciding changes shared work, so it needs this phone's operate access: without it the sheet only
 * shows the call, and its one button says to decide on a computer. The note is kept when a
 * decision fails, to send again.
 */
export function OwnerCallSheet({
  item,
  environments,
  onClose,
}: {
  readonly item: OwnerCallItem;
  readonly environments: ReadonlyArray<OwnerCallEnvironment>;
  readonly onClose: () => void;
}) {
  const now = useMinuteClock();
  const context = ownerCallContext(item, environments);
  const environmentId = context.host?.environmentId ?? item.environmentId;
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId));
  const controls = ownerCallControls(item, {
    connected: context.host !== undefined,
    hubError: context.host?.status?.error != null,
    canOperate: canDecide(session?.scopes),
  });
  const text = ownerCallSheetText(item, context, now);
  const decide = useAtomCommand(serverEnvironment.peerOwnership.decide, { reportFailure: false });
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState<PeerOwnershipDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waiting = deciding !== null || controls.reason !== null;

  const send = (decision: PeerOwnershipDecision) => {
    setDeciding(decision);
    setError(null);
    void decide({ environmentId, input: ownerCallDecision(item, decision, note) })
      .then((result) => {
        if (result._tag === "Success") onClose();
        else if (!isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => setDeciding(null));
  };

  return (
    <Modal
      visible
      presentationStyle="pageSheet"
      animationType="slide"
      allowSwipeDismissal
      onRequestClose={onClose}
    >
      <View collapsable={false} className="flex-1 bg-sheet-solid">
        <ScreenScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-3.5 px-4 pt-3 pb-7"
          keyboardShouldPersistTaps="handled"
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="h-1 w-10 self-center rounded-full bg-border"
          />
          <View className="gap-1">
            <AppText accessibilityRole="header" className="text-lg font-t3-bold">
              {text.title}
            </AppText>
            <AppText className="text-sm text-foreground-muted">{text.subtitle}</AppText>
          </View>
          <View className="gap-2 rounded-xl border border-warning-border bg-warning p-3">
            {text.paths.map((path) => (
              <AppText key={path} selectable className="font-mono text-xs">
                {path}
              </AppText>
            ))}
            {text.reason === "" ? null : (
              <AppText selectable className="text-sm">{`“${text.reason}”`}</AppText>
            )}
            <AppText className="text-xs text-foreground-muted">{text.footnote}</AppText>
          </View>
          {controls.reason === null ? null : (
            <AppText accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
              {controls.reason}
            </AppText>
          )}
          {controls.onYourComputer ? null : (
            <View className="gap-1.5">
              <AppText className="text-xs text-foreground-muted">{text.noteLabel}</AppText>
              <AppTextInput
                accessibilityLabel={text.noteLabel}
                multiline
                value={note}
                onChangeText={(value) => setNote(clampNote(value))}
                editable={deciding === null}
                textAlignVertical="top"
                className="min-h-24"
              />
              <AppText className="self-end text-xs text-foreground-muted">
                {noteCounter(note)}
              </AppText>
            </View>
          )}
          {controls.onYourComputer ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              disabled
              className="h-12 items-center justify-center rounded-xl border border-border bg-subtle opacity-60"
            >
              <AppText className="font-t3-medium text-foreground-muted">
                {DECIDE_ON_YOUR_COMPUTER}
              </AppText>
            </Pressable>
          ) : (
            <View className="flex-row gap-2.5">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: waiting }}
                disabled={waiting}
                onPress={() => send("decline")}
                className={cn(
                  "h-12 flex-1 items-center justify-center rounded-xl border border-danger-border bg-danger",
                  waiting && "opacity-50",
                )}
              >
                <AppText className="font-t3-medium text-danger-foreground">
                  {deciding === "decline" ? "Declining…" : controls.decline}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: waiting }}
                disabled={waiting}
                onPress={() => send("accept")}
                className={cn(
                  "h-12 flex-1 items-center justify-center rounded-xl border border-warning-foreground bg-warning-foreground",
                  waiting && "opacity-50",
                )}
              >
                <AppText className="font-t3-medium text-screen">
                  {deciding === "accept" ? "Accepting…" : controls.accept}
                </AppText>
              </Pressable>
            </View>
          )}
          {controls.onYourComputer ? null : (
            <AppText className="text-center text-xs text-foreground-muted">{text.hears}</AppText>
          )}
          {error === null ? null : (
            <AppText accessibilityRole="alert" className="text-sm text-danger-foreground">
              {error}
            </AppText>
          )}
        </ScreenScrollView>
      </View>
    </Modal>
  );
}
