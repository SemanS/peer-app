/**
 * The rooms feature's Hub endpoints (design D10). What a refusal means is the caller's.
 *
 * @module peerHub/plugins/rooms/hub
 */
import {
  PeerRoomInbox,
  PeerRoomMessage,
  PeerRoomRead,
  PeerRoomsSeenResult,
  PeerRoomsSetReachResult,
  type PeerRoomAnchor,
  type PeerRoomCapacity,
  type PeerRoomMove,
  type PeerRoomReachValue,
  type PeerRoomTargetInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../../core/hub/PeerHubClient.ts";

export interface Place {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}

export interface PostBody {
  readonly op: string;
  readonly text: string;
  readonly to: ReadonlyArray<PeerRoomTargetInput>;
  readonly environment: string;
  readonly anchor?: PeerRoomAnchor | undefined;
  readonly replyTo?: number | undefined;
  /** An agent's post: the run it comes from. A person's names none. */
  readonly run?: string | undefined;
}

export interface MoveBody {
  readonly move: PeerRoomMove;
  readonly environment?: string | undefined;
  readonly run?: string | undefined;
  readonly reason?: string | undefined;
  readonly expect?: string | undefined;
}

const Posted = Schema.Struct({ message: PeerRoomMessage });
const EMPTY_INBOX: PeerRoomInbox = { waiting: [], mentions: [], work: [], seqs: {} };

/** What a task's handoff packages say of where its work is, read as data of the `handoff` feature. */
const Handoffs = Schema.Struct({
  packages: Schema.Array(
    Schema.Struct({
      composedAt: Schema.optional(Schema.String),
      author: Schema.optional(Schema.String),
      delivery: Schema.optional(
        Schema.Struct({
          evidence: Schema.Struct({
            branch: Schema.optional(Schema.String),
            commit: Schema.optional(Schema.String),
            uncommitted: Schema.optional(Schema.Array(Schema.String)),
            untracked: Schema.optional(Schema.Array(Schema.String)),
          }),
        }),
      ),
    }),
  ),
});

const segment = encodeURIComponent;
const room = ({ project, task }: Place) =>
  `/projects/${segment(project)}/tasks/${segment(task)}/room`;

const defined = <A extends object>(body: A) =>
  Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));

/** The endpoints, called on the signed-in session. */
export const roomsHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  read: (place: Place, range: { readonly after?: number; readonly limit?: number } = {}) => {
    const query = new URLSearchParams(
      Object.entries(range).map(([key, value]): [string, string] => [key, String(value)]),
    ).toString();
    return client.request(PeerRoomRead, {
      workspace: place.workspace,
      path: `${room(place)}${query === "" ? "" : `?${query}`}`,
    });
  },
  /** The same `op` posts once. */
  post: (place: Place, body: PostBody) =>
    client
      .request(Posted, {
        workspace: place.workspace,
        path: room(place),
        method: "POST",
        body: defined(body),
      })
      .pipe(Effect.map(({ message }) => message)),
  seen: (place: Place, seq: number) =>
    client.request(PeerRoomsSeenResult, {
      workspace: place.workspace,
      path: `${room(place)}/seen`,
      method: "POST",
      body: { seq },
    }),
  /** A move on one person's delivery; `409 stale_delivery` says the state moved. */
  move: (place: Place, seq: number, email: string, body: MoveBody) =>
    client
      .request(Posted, {
        workspace: place.workspace,
        path: `${room(place)}/${seq}/deliveries/${segment(email)}`,
        method: "PATCH",
        body: defined(body),
      })
      .pipe(Effect.map(({ message }) => message)),
  withdraw: (place: Place, seq: number) =>
    client
      .request(Posted, {
        workspace: place.workspace,
        path: `${room(place)}/${seq}`,
        method: "DELETE",
      })
      .pipe(Effect.map(({ message }) => message)),
  reach: (
    workspace: string,
    project: string,
    run: string,
    body: { readonly reach: PeerRoomReachValue; readonly capacity: PeerRoomCapacity },
  ) =>
    client.request(PeerRoomsSetReachResult, {
      workspace,
      path: `/projects/${segment(project)}/runs/${segment(run)}/reach`,
      method: "PUT",
      body,
    }),
  /** What waits on the person and what this environment acts on; nothing from a Hub without rooms. */
  inbox: (workspace: string, environment: string) =>
    client.request(PeerRoomInbox, {
      workspace,
      path: `/rooms/inbox?environment=${segment(environment)}`,
      unsupported: { value: EMPTY_INBOX },
    }),
  /** The task's handoff packages, oldest first as the Hub keeps them; none where it keeps none. */
  handoffs: ({ workspace, project, task }: Place) =>
    client
      .request(Handoffs, {
        workspace,
        path: `/handoffs/${segment(project)}/${segment(task)}`,
        unsupported: { value: { packages: [] } },
      })
      .pipe(Effect.map(({ packages }) => packages)),
});

export type RoomsHub = ReturnType<typeof roomsHub>;
