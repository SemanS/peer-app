import type { RoomAction } from "@t3tools/client-runtime/peer/rooms";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { relativeTime } from "../../../lib/time";
import { ROOM_ACTION_WORDS, type RoomMessageView } from "./rooms.logic";

/** One message: who wrote it, its text, and a plain line per delivery with what may be done. */
export const RoomMessageRow = memo(function RoomMessageRow({
  view,
  busy,
  canAct,
  error,
  onAction,
}: {
  readonly view: RoomMessageView;
  readonly busy: boolean;
  readonly canAct: boolean;
  readonly error: string | null;
  readonly onAction: (seq: number, action: RoomAction, expect: string) => void;
}) {
  return (
    <View className="gap-1 rounded-xl border border-border bg-card p-3">
      <AppText className="text-xs font-t3-medium text-foreground-muted">
        {view.author} · #{view.seq} · {relativeTime(view.at)}
      </AppText>
      {view.reply === null ? null : (
        <AppText className="text-xs text-foreground-muted">{view.reply}</AppText>
      )}
      {view.anchor === null ? null : (
        <AppText selectable className="font-t3-mono text-xs text-foreground-muted">
          {view.anchor}
        </AppText>
      )}
      <AppText selectable>{view.text}</AppText>
      {view.names === null ? null : (
        <AppText className="text-sm text-foreground-muted">{view.names}</AppText>
      )}
      {view.deliveries.map((delivery) => (
        <View key={delivery.key} className="gap-1">
          <AppText className="text-sm text-foreground-muted">{delivery.words}</AppText>
          {!canAct || delivery.actions.length === 0 ? null : (
            <View className="flex-row flex-wrap gap-x-5">
              {delivery.actions.map((action) => (
                <Pressable
                  key={action}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  className="min-h-11 justify-center"
                  onPress={() => onAction(view.seq, action, delivery.state)}
                >
                  <AppText className="text-primary">{ROOM_ACTION_WORDS[action]}</AppText>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ))}
      {error === null ? null : (
        <AppText accessibilityRole="alert" className="text-sm text-destructive">
          {error}
        </AppText>
      )}
    </View>
  );
});
