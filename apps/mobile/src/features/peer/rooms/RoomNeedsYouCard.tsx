import { useNavigation } from "@react-navigation/native";
import type { PeerRoomMessage } from "@t3tools/contracts";
import { memo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import {
  ROOM_ACTION_WORDS,
  UNCONFIRMED_MOVE,
  type RoomCommandEnd,
  type RoomNeed,
} from "./rooms.logic";
import { useRoomMoves } from "./useRoomMoves";

function Action({
  label,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      className="min-h-11 justify-center"
      onPress={onPress}
    >
      <AppText className={disabled ? "text-foreground-muted" : "text-primary"}>{label}</AppText>
    </Pressable>
  );
}

function RoomNeedItem({ item }: { readonly item: RoomNeed }) {
  const navigation = useNavigation();
  const { allowed, move, askDecline } = useRoomMoves(item.environmentId);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const place = { workspace: item.workspace, project: item.project, task: item.task };
  const finish = (word: string, end: RoomCommandEnd<PeerRoomMessage>) => {
    setBusy(false);
    if (end.kind === "done") setDone(word);
    else setError(end.kind === "unknown" ? UNCONFIRMED_MOVE : end.message);
  };
  const start = () => {
    setBusy(true);
    setError(null);
  };
  const locked = busy || done !== null || item.offline || !allowed;
  return (
    <View className="gap-1 border-t border-border pt-2">
      <AppText className="font-t3-medium">{item.title}</AppText>
      <AppText className="text-sm text-foreground-muted">{item.text}</AppText>
      {item.cutNote === null ? null : (
        <AppText className="text-xs text-foreground-muted">{item.cutNote}</AppText>
      )}
      {item.offline ? (
        <AppText className="text-sm text-foreground-muted">
          {item.environmentLabel} is offline. Connect it to answer.
        </AppText>
      ) : null}
      {done === null ? null : <AppText accessibilityLiveRegion="polite">{done}</AppText>}
      {error === null ? null : (
        <AppText accessibilityRole="alert" className="text-sm text-destructive">
          {error}
        </AppText>
      )}
      <View className="flex-row flex-wrap gap-x-5">
        {item.actions.includes("pass") ? (
          <Action
            label={ROOM_ACTION_WORDS.pass}
            disabled={locked}
            onPress={() => {
              start();
              void move(place, item.seq, "pass", "waiting").then((end) =>
                finish("Passed on.", end),
              );
            }}
          />
        ) : null}
        {item.actions.includes("decline") ? (
          <Action
            label={ROOM_ACTION_WORDS.decline}
            disabled={locked}
            onPress={() =>
              askDecline(place, item.seq, "waiting", start, (end) => finish("Declined.", end))
            }
          />
        ) : null}
        <Action
          label="Open room"
          disabled={false}
          onPress={() =>
            navigation.navigate("Room", { environmentId: String(item.environmentId), ...place })
          }
        />
      </View>
    </View>
  );
}

/** What waits on the person in one task's room: Pass on, Decline and Open room, per message. */
export const RoomNeedsYouCard = memo(function RoomNeedsYouCard({
  items,
}: {
  readonly items: ReadonlyArray<RoomNeed>;
}) {
  const first = items[0];
  if (first === undefined) return null;
  return (
    <View accessibilityRole="summary" className="gap-2 rounded-xl border border-border bg-card p-4">
      <AppText className="text-xs font-t3-medium text-foreground-muted">
        Room · {first.projectName}
      </AppText>
      <AppText accessibilityRole="header" className="text-base font-t3-semibold">
        {first.taskTitle}
      </AppText>
      {items.map((item) => (
        <RoomNeedItem key={item.key} item={item} />
      ))}
    </View>
  );
});
