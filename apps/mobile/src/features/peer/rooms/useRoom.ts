import { useAtomValue } from "@effect/atom-react";
import { useIsFocused } from "@react-navigation/native";
import { roomSeq, type RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type {
  EnvironmentId,
  PeerHubStatus,
  PeerRoomMessage,
  PeerRoomRead,
} from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { ROOM_READ_LIMIT, seenToSend, withMessage } from "./rooms.logic";

interface Kept {
  /** The read this was kept from: a newer read replaces it, answers included. */
  readonly read: PeerRoomRead;
  readonly view: PeerRoomRead;
}

/**
 * A task's room, read again only when the status says its sequence moved, never on a timer. The
 * last read stays on screen meanwhile. `apply` puts the Hub's answer to a post or a move in at once;
 * the next read replaces it. What the person has on screen is marked seen while the screen is in
 * front.
 */
export function useRoom(input: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly place: RoomPlace;
}) {
  const { environmentId, status, place } = input;
  const query = useEnvironmentQuery(
    serverEnvironment.peerRooms.read({
      environmentId,
      input: { ...place, limit: ROOM_READ_LIMIT },
    }),
  );
  const { refresh } = query;

  const seq = roomSeq(status.rooms, place);
  // The query reads on mount; only a later move of the sequence reads again.
  const lastSeq = useRef(seq);
  useEffect(() => {
    if (seq === lastSeq.current) return;
    lastSeq.current = seq;
    refresh();
  }, [refresh, seq]);

  const [kept, setKept] = useState<Kept | undefined>(undefined);
  const read = query.data ?? undefined;
  if (read !== undefined && kept?.read !== read) setKept({ read, view: read });
  const view = kept?.view ?? read ?? null;

  const apply = useCallback(
    (message: PeerRoomMessage) =>
      setKept((current) =>
        current === undefined ? current : { ...current, view: withMessage(current.view, message) },
      ),
    [],
  );

  const focused = useIsFocused();
  const markSeen = useAtomCommand(serverEnvironment.peerRooms.seen, { reportFailure: false });
  const canMark = useAtomValue(serverEnvironment.peerRooms.seen.permissionAtom(environmentId));
  const marked = useRef(0);
  useEffect(() => {
    if (!focused || !canMark) return;
    const next = seenToSend(view, marked.current);
    if (next === null) return;
    marked.current = next;
    void markSeen({ environmentId, input: { ...place, seq: next } });
  }, [canMark, environmentId, focused, markSeen, place, view]);

  return { view, error: query.error, refresh, apply };
}
