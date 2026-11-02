/**
 * Rooms without a Hub: one room per project on this computer, for one person and their agents, kept
 * in Peer's own state. There is nobody to ask, so nothing here routes or waits: every running agent
 * of the project hears what is said, at its next step.
 *
 * @module peerHub/plugins/rooms/client/local
 */
import {
  PEER_LOCAL_WORKSPACE,
  type PeerRoomAnchor,
  type PeerRoomInbox,
  type PeerRoomMark,
  type PeerRoomMessage,
  type PeerRoomRead,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as PeerState from "../../../core/state/PeerState.ts";
import { runRootsData, type LocalRoom } from "../../../core/plugin.ts";

/** A local project's one room, in the place a task's id takes. */
export const LOCAL_ROOM = "room";
/** The one person a local room knows. */
export const LOCAL_PERSON = "local";
const KEPT = 200;
const DEFAULT_LIMIT = 50;

const EMPTY: LocalRoom = { seq: 0, seen: 0, ops: {}, messages: [] };

export const isLocalRoom = (workspace: string) => workspace === PEER_LOCAL_WORKSPACE;

export interface LocalPost {
  readonly op: string;
  readonly text: string;
  readonly anchor?: PeerRoomAnchor | undefined;
  readonly replyTo?: number | undefined;
  readonly mark?: PeerRoomMark | undefined;
  /** The agent's session, on an agent's post. */
  readonly run?: string | undefined;
  readonly agent?: string | undefined;
}

const stamped = (room: LocalRoom, post: LocalPost, at: string): PeerRoomMessage => ({
  seq: room.seq + 1,
  task: LOCAL_ROOM,
  at,
  author: {
    email: LOCAL_PERSON,
    ...(post.run === undefined ? {} : { run: post.run }),
    ...(post.agent === undefined ? {} : { agent: post.agent }),
  },
  text: post.text,
  to: [],
  ...(post.anchor === undefined ? {} : { anchor: post.anchor }),
  ...(post.replyTo === undefined ? {} : { replyTo: post.replyTo }),
  ...(post.mark === undefined ? {} : { mark: post.mark }),
});

const withPost = (room: LocalRoom, post: LocalPost, message: PeerRoomMessage): LocalRoom => {
  const messages = [...room.messages, message].slice(-KEPT);
  const oldest = messages[0]?.seq ?? 0;
  return {
    ...room,
    seq: message.seq,
    messages,
    ops: {
      ...Object.fromEntries(Object.entries(room.ops).filter(([, seq]) => seq >= oldest)),
      [post.op]: message.seq,
    },
  };
};

export const localRoomsOf = (state: PeerState.PeerState["Service"]) => {
  const data = runRootsData(state);
  const change = (project: string, next: (room: LocalRoom) => LocalRoom) =>
    data
      .update((current) => {
        const stored = Option.getOrUndefined(current);
        return {
          ...stored,
          runs: stored?.runs ?? {},
          localRooms: {
            ...stored?.localRooms,
            [project]: next(stored?.localRooms?.[project] ?? EMPTY),
          },
        };
      })
      .pipe(state.lock.withPermits(1));
  const roomOf = (project: string) =>
    Effect.map(
      data.read,
      (stored) => Option.getOrUndefined(stored)?.localRooms?.[project] ?? EMPTY,
    );

  return {
    read: (
      project: string,
      range: { readonly after?: number | undefined; readonly limit?: number | undefined } = {},
    ) =>
      Effect.map(roomOf(project), (room): PeerRoomRead => {
        const limit = range.limit ?? DEFAULT_LIMIT;
        const after = range.after;
        const messages =
          after === undefined
            ? room.messages.slice(-limit)
            : room.messages.filter((message) => message.seq > after).slice(0, limit);
        return { seq: room.seq, seen: room.seen, messages };
      }),
    /** The same `op` posts once. */
    post: Effect.fn("LocalRooms.post")(function* (project: string, post: LocalPost) {
      const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
      const room = yield* roomOf(project);
      const repeated = room.ops[post.op];
      const first = room.messages.find((message) => message.seq === repeated);
      if (first !== undefined) return first;
      const message = stamped(room, post, at);
      yield* change(project, (current) => withPost(current, post, message));
      return message;
    }),
    seen: Effect.fn("LocalRooms.seen")(function* (project: string, seq: number) {
      const seen = Math.max((yield* roomOf(project)).seen, seq);
      yield* change(project, (current) => ({ ...current, seen }));
      return { seen };
    }),
    /** Every local room, as a Hub's inbox says of its rooms: nothing here waits on anyone. */
    inbox: Effect.map(data.read, (stored): PeerRoomInbox => {
      const rooms = Object.entries(Option.getOrUndefined(stored)?.localRooms ?? {});
      const each = (value: (room: LocalRoom) => number) =>
        Object.fromEntries(
          rooms.map(([project, room]) => [project, { [LOCAL_ROOM]: value(room) }]),
        );
      return {
        waiting: [],
        mentions: [],
        work: [],
        seqs: each((room) => room.seq),
        revs: each((room) => room.seq),
        rooms: rooms.map(([project, room]) => {
          const last = room.messages.at(-1);
          return {
            project,
            task: LOCAL_ROOM,
            seq: room.seq,
            seen: room.seen,
            ...(last === undefined ? {} : { updated: last.at, author: last.author }),
            ...(last?.mark === undefined ? {} : { mark: last.mark }),
          };
        }),
      };
    }),
  };
};

export type LocalRooms = ReturnType<typeof localRoomsOf>;
