import type { NeedsYouEnvironment } from "@t3tools/client-runtime/peer/needs-you";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "../../../components/AppText";
import { cn } from "../../../lib/cn";
import {
  ownerCallCardText,
  ownerCallContext,
  ownerCallControls,
  ownerCallLabels,
  type OwnerCallItem,
} from "./ownerCall.logic";
import { OwnerCallSheet } from "./OwnerCallSheet";
import { PersonMark } from "./PersonMark";
import { useMinuteClock } from "./useMinuteClock";

/**
 * An owner's call in Needs you: an agent of someone else asks to change a path its person does
 * not own, or, for a lead, a path of an owner who left. The card says who asks, where, which paths
 * and in whose words; Decide opens the sheet where it is accepted or declined.
 */
export function OwnerCallCard({
  item,
  environments,
  focused,
}: {
  readonly item: OwnerCallItem;
  readonly environments: ReadonlyArray<NeedsYouEnvironment>;
  readonly focused: boolean;
}) {
  const now = useMinuteClock();
  const [deciding, setDeciding] = useState(false);
  const text = ownerCallCardText(item, ownerCallContext(item, environments), now);
  const labels = ownerCallLabels(item);
  // What can wait on the computer shows here; operate access is the sheet's to say.
  const wait = ownerCallControls(item, {
    connected: !item.offline,
    hubError: item.hubError,
    canOperate: true,
  }).reason;
  return (
    <>
      <View
        accessibilityRole="summary"
        accessibilityLabel={`Owner's call from ${item.asker}'s agent`}
        className={cn(
          "gap-2.5 rounded-xl border bg-warning p-3.5",
          focused ? "border-primary" : "border-warning-border",
        )}
      >
        <View className="flex-row items-center gap-2">
          <PersonMark name={item.asker} colorKey={item.call.email} small />
          <AppText accessibilityRole="header" className="min-w-0 flex-1 text-base font-t3-medium">
            {text.title}
          </AppText>
        </View>
        <AppText className="text-sm text-foreground-muted">{text.context}</AppText>
        <View className="gap-0.5">
          {text.paths.map((path) => (
            <AppText key={path} selectable className="font-mono text-xs">
              {path}
            </AppText>
          ))}
          {text.morePaths > 0 ? (
            <AppText className="text-xs text-foreground-muted">{`and ${text.morePaths} more`}</AppText>
          ) : null}
        </View>
        <AppText className="rounded-lg bg-subtle px-2.5 py-2 text-sm">{text.quote}</AppText>
        {text.guidance === undefined ? null : (
          <AppText className="text-sm text-foreground-muted">{text.guidance}</AppText>
        )}
        {wait === null ? null : (
          <AppText accessibilityRole="alert" className="text-sm text-foreground-muted">
            {wait}
          </AppText>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: item.offline }}
          disabled={item.offline}
          onPress={() => setDeciding(true)}
          className="h-11 items-center justify-center rounded-xl bg-warning-foreground disabled:opacity-50"
        >
          <AppText className="font-t3-medium text-screen">{labels.entry}</AppText>
        </Pressable>
      </View>
      {deciding ? (
        <OwnerCallSheet
          item={item}
          environments={environments}
          onClose={() => setDeciding(false)}
        />
      ) : null}
    </>
  );
}
