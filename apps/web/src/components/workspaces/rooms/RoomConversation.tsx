import {
  anchorState,
  anchorText,
  availableActions,
  deliveryWords,
  type NameOf,
  type RoomAction,
  type RoomPlace,
} from "@t3tools/client-runtime/peer/rooms";
import type { PeerRoomAnchor, PeerRoomMessage, PeerRoomTarget } from "@t3tools/contracts";
import { BotIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useClientSettings } from "../../../hooks/useSettings";
import { cn } from "../../../lib/utils";
import { formatShortTimestamp } from "../../../timestampFormat";
import { Button } from "../../ui/button";
import { TONE_TEXT } from "../signals";
import { PersonMark } from "../task/TaskSections";
import { DeclineDialog } from "./DeclineDialog";
import { authorOf, deliveriesOf, deliveryTone, mentionsOf, ROOM_PAGE } from "./room.logic";
import type { useRoomMoves } from "./useRoom";

const ACTION_LABEL: Readonly<Record<RoomAction, string>> = {
  pass: "Pass on",
  decline: "Decline",
  withdraw: "Withdraw",
  tryAgain: "Try again",
};

/** The element a message is on, for what scrolls to it from the diff. */
export const roomMessageId = (seq: number) => `room-message-${seq}`;

/** Within this of the end, a new message keeps the reader at the end. */
const AT_END_PX = 96;

/**
 * The room's messages in one column, oldest first, each with the plain line of each delivery and
 * what the reader may do with it. People's names are set in the text face, agents' in the code face
 * with a mark, so they are told apart without colour.
 */
export function RoomConversation({
  place,
  messages,
  total,
  me,
  nameOf,
  head,
  canAct,
  moves,
  error,
  loading,
  onOpenAnchor,
}: {
  readonly place: RoomPlace;
  readonly messages: ReadonlyArray<PeerRoomMessage>;
  /** The newest sequence: more than the page holds says older messages are not shown. */
  readonly total: number;
  readonly me: string;
  readonly nameOf: NameOf;
  /** The diff's head, so an anchor can say it was made on an earlier version. */
  readonly head: string | undefined;
  readonly canAct: boolean;
  readonly moves: ReturnType<typeof useRoomMoves>;
  readonly error: string | null;
  readonly loading: boolean;
  readonly onOpenAnchor: (anchor: PeerRoomAnchor) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const last = messages.at(-1)?.seq;
  const atEnd = useRef(true);
  useEffect(() => {
    const element = scroller.current;
    if (last === undefined || element === null || !atEnd.current) return;
    element.scrollTop = element.scrollHeight;
  }, [last]);
  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      onScroll={(event) => {
        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
        atEnd.current = scrollHeight - scrollTop - clientHeight < AT_END_PX;
      }}
    >
      <div className="flex min-h-full flex-col justify-end gap-5 px-4 py-5 sm:px-6">
        {error === null ? null : (
          <p role="alert" className="text-sm text-muted-foreground">
            {error}
          </p>
        )}
        {total > messages.length && messages.length >= ROOM_PAGE ? (
          <p className="text-xs text-muted-foreground">
            The newest {messages.length} of {total} messages.
          </p>
        ) : null}
        {messages.length === 0 && error === null ? (
          <p role={loading ? "status" : undefined} className="text-sm text-muted-foreground">
            {loading
              ? "Reading the room…"
              : "Nobody has written here yet. A message to the team reaches people only; name an agent to start a turn."}
          </p>
        ) : null}
        {messages.map((message) => (
          <RoomMessage
            key={message.seq}
            place={place}
            message={message}
            me={me}
            nameOf={nameOf}
            head={head}
            canAct={canAct}
            moves={moves}
            onOpenAnchor={onOpenAnchor}
          />
        ))}
      </div>
    </div>
  );
}

function RoomMessage({
  place,
  message,
  me,
  nameOf,
  head,
  canAct,
  moves,
  onOpenAnchor,
}: {
  readonly place: RoomPlace;
  readonly message: PeerRoomMessage;
  readonly me: string;
  readonly nameOf: NameOf;
  readonly head: string | undefined;
  readonly canAct: boolean;
  readonly moves: ReturnType<typeof useRoomMoves>;
  readonly onOpenAnchor: (anchor: PeerRoomAnchor) => void;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const author = authorOf(message, me, nameOf);
  const mentions = mentionsOf(message);
  const note = moves.notes.get(message.seq);
  const anchor = message.anchor;
  return (
    <article
      id={roomMessageId(message.seq)}
      aria-label={`#${message.seq} from ${author.name}`}
      className="flex min-w-0 scroll-mt-4 gap-3"
    >
      {author.kind === "agent" ? (
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
        >
          <BotIcon className="size-4" />
        </span>
      ) : (
        <PersonMark name={author.name} mine={author.name === "You"} />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-muted-foreground">
          {author.kind === "agent" ? (
            <span className="font-mono text-xs text-foreground">
              {author.name}
              {author.harness === undefined ? null : ` · ${author.harness}`}
            </span>
          ) : (
            <span className="text-sm font-semibold text-foreground">{author.name}</span>
          )}
          <span className="text-xs">{formatShortTimestamp(message.at, timestampFormat)}</span>
          <span className="text-xs tabular-nums">#{message.seq}</span>
          {message.replyTo === undefined ? null : (
            <span className="text-xs tabular-nums">to #{message.replyTo}</span>
          )}
        </p>
        {anchor === undefined ? null : (
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
            <button
              type="button"
              className="min-w-0 rounded-sm font-mono [overflow-wrap:anywhere] text-foreground/80 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => onOpenAnchor(anchor)}
            >
              {anchorText(anchor)}
            </button>
            {anchorState(anchor, head) === "earlier" ? <span>on an earlier version</span> : null}
          </p>
        )}
        <p className="text-sm whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
          {message.text}
        </p>
        {mentions.length === 0 ? null : (
          <p className="text-xs text-muted-foreground">
            To {mentions.map((target) => nameOf(target.email)).join(", ")}
          </p>
        )}
        {deliveriesOf(message).map((delivery) => (
          <DeliveryLine
            key={delivery.email}
            place={place}
            message={message}
            delivery={delivery}
            me={me}
            nameOf={nameOf}
            canAct={canAct}
            moves={moves}
          />
        ))}
        {note === undefined ? null : (
          <p role="status" className="text-xs text-warning-foreground">
            {note}
          </p>
        )}
      </div>
    </article>
  );
}

/** A delivery's state in words, then what this reader may do with it. */
function DeliveryLine({
  place,
  message,
  delivery,
  me,
  nameOf,
  canAct,
  moves,
}: {
  readonly place: RoomPlace;
  readonly message: PeerRoomMessage;
  readonly delivery: PeerRoomTarget;
  readonly me: string;
  readonly nameOf: NameOf;
  readonly canAct: boolean;
  readonly moves: ReturnType<typeof useRoomMoves>;
}) {
  const [declining, setDeclining] = useState(false);
  const words = deliveryWords(delivery, { me, nameOf });
  const actions = canAct ? availableActions(message, delivery, me) : [];
  const busy = moves.busy === message.seq;
  const run = (action: RoomAction) => {
    switch (action) {
      case "pass":
      case "tryAgain":
        void moves.pass(place, message.seq, delivery.state);
        break;
      case "decline":
        setDeclining(true);
        break;
      case "withdraw":
        void moves.withdraw(place, message.seq);
        break;
    }
  };
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
      <span className={cn("text-xs", TONE_TEXT[deliveryTone(delivery)])}>{words}</span>
      {actions.map((action) => (
        <Button
          key={action}
          size="compact"
          variant={action === "pass" || action === "tryAgain" ? "outline" : "ghost-muted"}
          disabled={busy}
          onClick={() => run(action)}
        >
          {ACTION_LABEL[action]}
        </Button>
      ))}
      {declining ? (
        <DeclineDialog
          who={nameOf(message.author.email)}
          busy={busy}
          onDecline={(reason) => {
            void moves.decline(place, message.seq, reason).then((done) => {
              if (done) setDeclining(false);
            });
          }}
          onClose={() => setDeclining(false)}
        />
      ) : null}
    </div>
  );
}
