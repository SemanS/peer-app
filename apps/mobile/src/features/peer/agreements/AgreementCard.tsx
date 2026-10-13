/**
 * One agreement of the task's list: its state, the other task, who settled it and when, and the
 * words the agents agreed. The words and names are teammate text, so they are text children only,
 * selectable, never markup or a link. A person closes it as handled or not needed, or brings back
 * one a person closed; what each row offers is `agreement.logic`'s to decide.
 */
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { cn } from "../../../lib/cn";
import { ToneChip } from "../work/WorkMarks";
import { CLOSE_CHOICES, type AgreementAction, type AgreementRow } from "./agreements.logic";

function ActionButton({
  label,
  pendingLabel,
  accessibilityLabel,
  pending,
  disabled,
  className,
  onPress,
}: {
  readonly label: string;
  readonly pendingLabel: string;
  readonly accessibilityLabel: string;
  /** This button's own action is running. */
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly className?: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: pending }}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        "h-11 items-center justify-center rounded-xl border border-border bg-subtle px-4 disabled:opacity-50",
        className,
      )}
    >
      <Text className="font-t3-medium text-foreground">{pending ? pendingLabel : label}</Text>
    </Pressable>
  );
}

export function AgreementCard({
  row,
  disabled,
  acting,
  error,
  onAct,
}: {
  readonly row: AgreementRow;
  /** An action is running, here or elsewhere on the screen: the buttons wait. */
  readonly disabled: boolean;
  /** The action this row has running. */
  readonly acting: AgreementAction | null;
  /** Why the last action on this row failed; the row stays as it was. */
  readonly error: string | null;
  readonly onAct: (action: AgreementAction) => void;
}) {
  return (
    <View className="gap-2.5 rounded-xl border border-border bg-card p-4">
      <View className="items-start gap-1.5">
        <ToneChip tone={row.tone} label={row.state} />
        <Text selectable className="font-t3-medium text-foreground">
          {row.heading}
        </Text>
        <Text selectable className="text-sm text-foreground-muted">
          {row.settled}
        </Text>
      </View>
      <Text selectable className="rounded-lg bg-subtle px-2.5 py-2 text-sm text-foreground">
        {row.quote}
      </Text>
      {error === null ? null : (
        <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
          {error}
        </Text>
      )}
      {row.close ? (
        <View className="gap-1.5">
          <Text className="text-xs text-foreground-muted">Close as</Text>
          <View className="flex-row gap-2.5">
            {CLOSE_CHOICES.map(({ why, label }) => (
              <ActionButton
                key={why}
                label={label}
                pendingLabel="Closing…"
                accessibilityLabel={`Close as ${label.toLowerCase()}`}
                pending={acting === why}
                disabled={disabled}
                className="flex-1"
                onPress={() => onAct(why)}
              />
            ))}
          </View>
        </View>
      ) : null}
      {row.reopen ? (
        <ActionButton
          label="Reopen"
          pendingLabel="Reopening…"
          accessibilityLabel="Reopen this agreement"
          pending={acting === "reopen"}
          disabled={disabled}
          className="self-start"
          onPress={() => onAct("reopen")}
        />
      ) : null}
    </View>
  );
}
