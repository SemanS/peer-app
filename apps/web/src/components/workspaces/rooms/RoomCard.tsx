import { personName } from "@t3tools/client-runtime/peer/needs-you";
import { roomBadgeCount, type RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { EnvironmentId, PeerHubStatus, PeerRoomMessage } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { PeerSectionLabel } from "../PeerPageHeader";
import type { TaskContextSlotProps, TaskSlotProps } from "../slots.types";
import { authorOf } from "./room.logic";
import { useRoomRead } from "./useRoom";

const CARD_MESSAGES = 3;

/** A task's room on its page and its review: the last messages, how many, and the way in. */
function RoomCard({
  environmentId,
  status,
  place,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly place: RoomPlace;
}) {
  const navigate = useNavigate();
  const { room, messages, error } = useRoomRead({
    environmentId,
    status,
    place,
    limit: CARD_MESSAGES,
  });
  const nameOf = (email: string) => personName(status, place.workspace, email);
  return (
    <section aria-labelledby="task-room" className="flex flex-col gap-2.5">
      <span id="task-room" className="contents">
        <PeerSectionLabel
          after={
            room === null || room.seq === 0 ? null : (
              <span className="font-normal text-muted-foreground tabular-nums">{room.seq}</span>
            )
          }
        >
          Room
        </PeerSectionLabel>
      </span>
      {error !== null && room === null ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {room === null ? "Reading the room…" : "Nobody has written here yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {messages.map((message) => (
            <CardLine key={message.seq} message={message} me={status.email} nameOf={nameOf} />
          ))}
        </ul>
      )}
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void navigate({ to: "/room/$workspace/$project/$task", params: place })}
        >
          Open room
        </Button>
      </div>
    </section>
  );
}

function CardLine({
  message,
  me,
  nameOf,
}: {
  readonly message: PeerRoomMessage;
  readonly me: string | null;
  readonly nameOf: (email: string) => string;
}) {
  const author = authorOf(message, me, nameOf);
  return (
    <li className="flex min-w-0 items-baseline gap-2 text-sm">
      <span
        className={
          author.kind === "agent"
            ? "shrink-0 font-mono text-xs text-foreground"
            : "shrink-0 font-semibold text-foreground"
        }
      >
        {author.name}
      </span>
      <span className="min-w-0 truncate text-muted-foreground">{message.text}</span>
    </li>
  );
}

/** The `taskSections` slot. */
export function RoomTaskSection({
  environmentId,
  status,
  workspace,
  project,
  task,
}: TaskSlotProps) {
  if (project === undefined) return null;
  return (
    <RoomCard
      environmentId={environmentId}
      status={status}
      place={{ workspace, project: project.project.id, task: task.id }}
    />
  );
}

/** The `taskReview` slot, whose task comes as a `task:<id>` scope. */
export function RoomReviewSection({
  environmentId,
  status,
  workspace,
  project,
  scope,
}: TaskContextSlotProps) {
  if (!scope.startsWith("task:")) return null;
  return (
    <RoomCard
      environmentId={environmentId}
      status={status}
      place={{ workspace, project, task: scope.slice("task:".length) }}
    />
  );
}

/** The `taskBadges` slot: how much in the task's room waits on this person. */
export function RoomBadge({ status, workspace, project, task }: TaskSlotProps) {
  if (project === undefined) return null;
  const count = roomBadgeCount(status.rooms, {
    workspace,
    project: project.project.id,
    task: task.id,
  });
  if (count === 0) return null;
  return (
    <Badge variant="warning" size="control">
      {count} in the room
    </Badge>
  );
}
