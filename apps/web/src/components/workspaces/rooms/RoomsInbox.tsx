import { useAtomValue } from "@effect/atom-react";
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import {
  needsYouByTask,
  roomNeedsYou,
  type RoomNeedsYouItem,
} from "@t3tools/client-runtime/peer/rooms";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";
import { useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Button } from "../../ui/button";
import type { NeedsYouSlotProps } from "../slots.types";
import { DeclineDialog } from "./DeclineDialog";
import { roomTaskLabel } from "./roomSlots.logic";
import { useRoomMoves } from "./useRoom";

/** Needs you's room items, grouped per task, so an owner asked ten times sees one place. */
export function RoomsInbox({ environmentId, status }: NeedsYouSlotProps) {
  const moves = useRoomMoves(environmentId, () => undefined);
  const canMove = useAtomValue(serverEnvironment.peerRooms.pass.permissionAtom(environmentId));
  const items = roomNeedsYou(status.rooms, (need) =>
    personName(status, need.workspace, need.author),
  );
  if (items.length === 0) return null;
  return (
    <section aria-label="Task rooms" className="flex flex-col gap-1">
      {needsYouByTask(items).map((group) => {
        const first = group.items[0];
        if (first === undefined) return null;
        return (
          <div key={group.key} className="flex flex-col gap-1">
            <p className="flex min-w-0 items-center gap-1.5 px-2 text-xs text-muted-foreground">
              <MessagesSquareIcon aria-hidden className="size-3 shrink-0" />
              <span className="truncate">Room of {roomTaskLabel(status, first)}</span>
            </p>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <RoomItem key={item.key} item={item} canMove={canMove} moves={moves} />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function RoomItem({
  item,
  canMove,
  moves,
}: {
  readonly item: RoomNeedsYouItem;
  readonly canMove: boolean;
  readonly moves: ReturnType<typeof useRoomMoves>;
}) {
  const navigate = useNavigate();
  const [declining, setDeclining] = useState(false);
  const place = { workspace: item.workspace, project: item.project, task: item.task };
  const busy = moves.busy === item.seq;
  const note = moves.notes.get(item.seq);
  return (
    <li className="flex min-w-0 list-none flex-col gap-1 rounded-lg border border-sidebar-border/70 bg-sidebar-control-surface px-2.5 py-2">
      <p className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
        <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
        <span className="shrink-0">· {formatRelativeTimeLabel(item.at)}</span>
      </p>
      <p className="line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {item.text}
      </p>
      {item.cutNote === null ? null : (
        <p className="text-xs text-muted-foreground">{item.cutNote}</p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {item.actions.includes("pass") && canMove ? (
          <Button
            size="compact"
            variant="outline"
            disabled={busy}
            onClick={() => void moves.pass(place, item.seq, "waiting")}
          >
            Pass on
          </Button>
        ) : null}
        {item.actions.includes("decline") && canMove ? (
          <Button
            size="compact"
            variant="ghost-muted"
            disabled={busy}
            onClick={() => setDeclining(true)}
          >
            Decline
          </Button>
        ) : null}
        <Button
          size="compact"
          variant="ghost-muted"
          onClick={() => void navigate({ to: "/room/$workspace/$project/$task", params: place })}
        >
          Open room
        </Button>
      </div>
      {note === undefined ? null : (
        <p role="status" className="text-xs text-warning-foreground">
          {note}
        </p>
      )}
      {declining ? (
        <DeclineDialog
          busy={busy}
          onDecline={(reason) => {
            void moves.decline(place, item.seq, reason).then((done) => {
              if (done) setDeclining(false);
            });
          }}
          onClose={() => setDeclining(false)}
        />
      ) : null}
    </li>
  );
}
