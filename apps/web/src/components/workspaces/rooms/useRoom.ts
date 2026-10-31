import { nextLostStart, roomRev, type RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import {
  isAtomCommandInterrupted,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PeerHubStatus,
  PeerRoomMessage,
  PeerRoomStep,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { hubFailure } from "../WorkspaceAccess";
import {
  draftStorageKey,
  EMPTY_DRAFT,
  isEmptyDraft,
  parseDraft,
  moveKey,
  ROOM_PAGE,
  type RoomDraft,
} from "./room.logic";

const NO_MESSAGES: ReadonlyArray<PeerRoomMessage> = [];
const NO_STEPS: ReadonlyArray<PeerRoomStep> = [];

/** Calls `refresh` whenever `revision` moves; the query itself reads on mount. */
function useRefetchOn(revision: string, refresh: () => void) {
  const seen = useRef(revision);
  useEffect(() => {
    if (revision === seen.current) return;
    seen.current = revision;
    refresh();
  }, [refresh, revision]);
}

/** A room's newest messages, read again when the status says it moved, never on a timer. */
export function useRoomRead(input: {
  readonly environmentId: EnvironmentId;
  readonly status: Pick<PeerHubStatus, "rooms">;
  readonly place: RoomPlace;
  readonly limit: number;
  /** What else moves the room: the task's runs, on the page. */
  readonly revision?: string;
}) {
  const { environmentId, status, place, limit, revision = "" } = input;
  const query = useEnvironmentQuery(
    serverEnvironment.peerRooms.read({ environmentId, input: { ...place, limit } }),
  );
  useRefetchOn(`${roomRev(status.rooms, place)}:${revision}`, query.refresh);
  const messages = query.data?.messages ?? NO_MESSAGES;
  // Try again appears when a start's grace ends, and nothing moves in the room to say so.
  const [now, setNow] = useState(() => Date.now());
  const graceEnd = nextLostStart(messages, now);
  useEffect(() => {
    if (graceEnd === null) return;
    const timer = setTimeout(() => setNow(Date.now()), graceEnd - Date.now());
    return () => clearTimeout(timer);
  }, [graceEnd]);
  return {
    room: query.data,
    messages,
    now,
    error: query.error,
    refresh: query.refresh,
  };
}

/** The Room page's read: as `useRoomRead`, and whatever the page shows counts as seen. */
export function useRoom(input: {
  readonly environmentId: EnvironmentId;
  readonly status: Pick<PeerHubStatus, "rooms">;
  readonly place: RoomPlace;
  readonly revision: string;
}) {
  const { environmentId, place } = input;
  const read = useRoomRead({ ...input, limit: ROOM_PAGE });
  const seen = useAtomCommand(serverEnvironment.peerRooms.seen, { reportFailure: false });
  const seq = read.room?.seq ?? 0;
  const known = read.room?.seen ?? 0;
  const reported = useRef(0);
  const { workspace, project, task } = place;
  useEffect(() => {
    if (seq <= known || seq <= reported.current) return;
    reported.current = seq;
    void seen({ environmentId, input: { workspace, project, task, seq } });
  }, [environmentId, known, project, seen, seq, task, workspace]);
  return read;
}

/**
 * The task's diff: on open, when its runs move, and when the person asks. A message does not fetch
 * it, since this runs `git fetch` on this computer and a conversation changes no code.
 */
export function useRoomDiff(input: {
  readonly environmentId: EnvironmentId;
  readonly place: RoomPlace;
  readonly revision: string;
  /** Reads that run's checkout instead of the task's newest work. */
  readonly run?: string;
  /** One of that run's steps. */
  readonly step?: string;
}) {
  const { environmentId, place, revision, run, step } = input;
  const query = useEnvironmentQuery(
    serverEnvironment.peerRooms.diff({
      environmentId,
      input: {
        ...place,
        ...(run === undefined ? {} : { run }),
        ...(step === undefined ? {} : { step }),
      },
    }),
  );
  useRefetchOn(revision, query.refresh);
  return { diff: query.data, error: query.error, refresh: query.refresh };
}

/** A run's thread, as it stood at `until`, or as it stands and read again as it moves. */
export function useRoomThread(input: {
  readonly environmentId: EnvironmentId;
  readonly place: RoomPlace;
  readonly run: string;
  readonly until: string | undefined;
  readonly revision: string;
}) {
  const { environmentId, place, run, until, revision } = input;
  const query = useEnvironmentQuery(
    serverEnvironment.peerRooms.thread({
      environmentId,
      input: { ...place, run, ...(until === undefined ? {} : { until }) },
    }),
  );
  useRefetchOn(revision, query.refresh);
  return { thread: query.data, error: query.error };
}

/** A run's steps and the change they make, on this computer, read again when it moves. */
export function useRoomSteps(input: {
  readonly environmentId: EnvironmentId;
  readonly place: RoomPlace;
  readonly run: string;
  readonly revision: string;
}) {
  const { environmentId, place, run, revision } = input;
  const query = useEnvironmentQuery(
    serverEnvironment.peerRooms.steps({ environmentId, input: { ...place, run } }),
  );
  useRefetchOn(revision, query.refresh);
  return { steps: query.data?.steps ?? NO_STEPS, change: query.data?.change };
}

function readStored(key: string): RoomDraft {
  try {
    return parseDraft(localStorage.getItem(key));
  } catch {
    return EMPTY_DRAFT;
  }
}

function writeStored(key: string, draft: RoomDraft) {
  try {
    if (isEmptyDraft(draft)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage may be blocked; the draft still lives while the page does.
  }
}

/** The room's draft, kept on this device, so leaving the page or a reload loses no words. */
export function useRoomDraft(place: RoomPlace) {
  const key = draftStorageKey(place);
  const [draft, setDraft] = useState(() => readStored(key));
  const latest = useRef(draft);
  const change = (next: RoomDraft | ((current: RoomDraft) => RoomDraft)) => {
    latest.current = typeof next === "function" ? next(latest.current) : next;
    setDraft(latest.current);
    writeStored(key, latest.current);
  };
  return [draft, change] as const;
}

/** What failed, in a line beside the button; a moved delivery is said as what happened. */
export function moveNote(result: AtomCommandResult<unknown, unknown>): string | null {
  if (result._tag === "Success") return null;
  if (isAtomCommandInterrupted(result))
    return "That could not be confirmed. Look again in a moment.";
  const failure = hubFailure(result);
  if (failure?.code === "stale_delivery") return "It moved on before your answer arrived.";
  return failure?.message ?? "That did not go through.";
}

/**
 * Pass on, Decline, Try again and Withdraw, from the room and from Needs you. Each says what the
 * Hub answered beside the message it was about, and the room is read again either way, since a
 * refused move means someone else moved it.
 */
export function useRoomMoves(environmentId: EnvironmentId, onMoved: () => void) {
  const pass = useAtomCommand(serverEnvironment.peerRooms.pass, { reportFailure: false });
  const decline = useAtomCommand(serverEnvironment.peerRooms.decline, { reportFailure: false });
  const withdraw = useAtomCommand(serverEnvironment.peerRooms.withdraw, { reportFailure: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map());
  const settle = async (
    place: RoomPlace,
    seq: number,
    move: () => Promise<AtomCommandResult<unknown, unknown>>,
  ) => {
    const key = moveKey(place, seq);
    setBusy(key);
    const result = await move();
    const text = moveNote(result);
    setBusy(null);
    setNotes((current) => {
      const next = new Map(current);
      if (text === null) next.delete(key);
      else next.set(key, text);
      return next;
    });
    onMoved();
    return text === null;
  };
  return {
    isBusy: (place: RoomPlace, seq: number) => busy === moveKey(place, seq),
    noteOf: (place: RoomPlace, seq: number) => notes.get(moveKey(place, seq)),
    /** Its owner's yes, and the retry of a failed or lost start. */
    pass: (place: RoomPlace, seq: number, expect: string | undefined) =>
      settle(place, seq, () =>
        pass({
          environmentId,
          input: { ...place, seq, ...(expect === undefined ? {} : { expect }) },
        }),
      ),
    decline: (place: RoomPlace, seq: number, reason: string) =>
      settle(place, seq, () =>
        decline({
          environmentId,
          input: { ...place, seq, expect: "waiting", ...(reason === "" ? {} : { reason }) },
        }),
      ),
    withdraw: (place: RoomPlace, seq: number) =>
      settle(place, seq, () => withdraw({ environmentId, input: { ...place, seq } })),
  };
}
