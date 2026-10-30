import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { RoomPlace, RoomTargetChoice } from "@t3tools/client-runtime/peer/rooms";
import type { EnvironmentId, PeerRoomMessage } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { AppText, AppTextInput } from "../../../components/ui/AppText";
import { Chip } from "../../../components/ui/Chip";
import { uuidv4 } from "../../../lib/uuid";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import {
  EMPTY_ROOM_DRAFT,
  afterSend,
  beginSend,
  chosenTarget,
  composerChoices,
  composerState,
  postInput,
  roomCommandEnd,
  type RoomDraft,
} from "./rooms.logic";

// Kept outside the screen so a draft outlives leaving the room, and a send that ends after the
// person left still clears or keeps it. It lives as long as the app does.
const roomDraftAtom = Atom.family((key: string) =>
  Atom.make<RoomDraft>(EMPTY_ROOM_DRAFT).pipe(Atom.keepAlive, Atom.withLabel(`room-draft:${key}`)),
);

/** The plain composer: Team, which is the default, or Your agent. A draft stays until it is sent. */
export function RoomComposer({
  environmentId,
  place,
  me,
  targets,
  onPosted,
}: {
  readonly environmentId: EnvironmentId;
  readonly place: RoomPlace;
  readonly me: string | null | undefined;
  readonly targets: ReadonlyArray<RoomTargetChoice>;
  readonly onPosted: (message: PeerRoomMessage) => void;
}) {
  const atom = roomDraftAtom(`${environmentId}/${place.workspace}/${place.project}/${place.task}`);
  const draft = useAtomValue(atom);
  const setDraft = useAtomSet(atom);
  const post = useAtomCommand(serverEnvironment.peerRooms.post, { reportFailure: false });
  const allowed = useAtomValue(serverEnvironment.peerRooms.post.permissionAtom(environmentId));
  const choices = useMemo(() => composerChoices(targets), [targets]);
  const target = chosenTarget(choices, draft.target);
  const { canSend, reason } = composerState({
    text: draft.text,
    sending: draft.sending,
    allowed,
    me,
    target,
  });

  const send = () => {
    if (!canSend || target === undefined) return;
    const sending = beginSend(draft, uuidv4);
    if (sending.pending === null) return;
    setDraft(sending);
    void post({
      environmentId,
      input: postInput(place, sending.pending, target.to),
    }).then((result) => {
      const end = roomCommandEnd(result);
      setDraft((current) => afterSend(current, end));
      if (end.kind === "done") onPosted(end.value);
    });
  };

  return (
    <View className="gap-2 border-t border-border bg-sheet px-5 pt-3 pb-4">
      <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
        {choices.map((choice) => (
          <Chip
            key={choice.key}
            label={choice.label}
            selected={choice.key === target?.key}
            disabled={draft.sending}
            accessibilityLabel={`Write to ${choice.label}`}
            onPress={() => setDraft((current) => ({ ...current, target: choice.key }))}
          />
        ))}
      </View>
      {reason === null ? null : (
        <AppText accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
          {reason}
        </AppText>
      )}
      <AppTextInput
        accessibilityLabel="Message to the room"
        placeholder={target?.kind === "own-agent" ? "Ask your agent" : "Write to the team"}
        value={draft.text}
        onChangeText={(text) => setDraft((current) => ({ ...current, text, notice: null }))}
        editable={!draft.sending}
        multiline
        className="max-h-32"
      />
      {draft.notice === null ? null : (
        <AppText accessibilityRole="alert" className="text-sm text-destructive">
          {draft.notice}
        </AppText>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSend }}
        disabled={!canSend}
        className="min-h-11 justify-center"
        onPress={send}
      >
        <AppText className={canSend ? "text-primary" : "text-foreground-muted"}>
          {draft.sending ? "Sending…" : "Send"}
        </AppText>
      </Pressable>
    </View>
  );
}
