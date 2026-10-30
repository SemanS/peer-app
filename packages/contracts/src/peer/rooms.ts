import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Peer's rooms plugin: a task's shared conversation between people and their agents (the Hub's
 * `rooms` feature). Rows mirror the Hub's wire contract field for field (camelCase, times as RFC 3339
 * strings). A delivery's state, a target's kind, a reach and a capacity are plain strings in rows, so
 * an app reads a newer Hub's; the values known today are listed beside them.
 *
 * `commandNames` (`peer room`) is not here: the plugin names its commands where it defines them.
 */
export const PEER_ROOMS_PLUGIN = {
  id: "rooms",
  title: "Task rooms",
  summary: "One conversation per task, where everyone brings their own agent.",
  defaultEnabled: true,
  hubFeature: { id: "rooms", revision: 1 },
} as const;

/** The states of a delivery, as Hubs name them today. */
export const PEER_ROOM_DELIVERY_STATES = [
  "waiting",
  "passed",
  "taken",
  "heard",
  "answered",
  "declined",
  "withdrawn",
  "expired",
  "failed",
] as const;
export type PeerRoomDeliveryState = (typeof PEER_ROOM_DELIVERY_STATES)[number];

/**
 * How long a `taken` delivery stands before Peer calls its session gone, and before its owner may
 * try a start with no run again; the Hub refuses that sooner with `409 still_starting`.
 */
export const PEER_ROOM_START_GRACE_MS = 120_000;

/** The moves a person's client or a Peer makes on a delivery. */
export const PEER_ROOM_MOVES = ["pass", "decline", "take", "fail", "heard"] as const;
export type PeerRoomMove = (typeof PEER_ROOM_MOVES)[number];

/** A run's reach: `own`, or `team` on the project's shared capacity. */
export const PeerRoomReachValue = Schema.Literals(["own", "team"]);
export type PeerRoomReachValue = typeof PeerRoomReachValue.Type;

/** What carries a run. A run whose capacity Peer cannot tell is `personal`. */
export const PeerRoomCapacity = Schema.Literals(["personal", "shared"]);
export type PeerRoomCapacity = typeof PeerRoomCapacity.Type;

/** The side of a diff an anchor's line is on. */
export const PEER_ROOM_ANCHOR_SIDES = ["old", "new"] as const;

/** Where a message sits on the change. The Hub stores no code with it. */
export const PeerRoomAnchor = Schema.Struct({
  path: Schema.String,
  line: Schema.Number,
  endLine: Schema.optional(Schema.Number),
  /** One of `PEER_ROOM_ANCHOR_SIDES`. */
  side: Schema.String,
  /** The diff's `head` it was made on, so a moved change can say so. */
  commit: Schema.optional(Schema.String),
});
export type PeerRoomAnchor = typeof PeerRoomAnchor.Type;

/** Who a message names, as a client sends it. */
export const PeerRoomTargetInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("person"), email: TrimmedNonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal("agent"),
    email: TrimmedNonEmptyString,
    harness: Schema.optional(TrimmedNonEmptyString),
  }),
]);
export type PeerRoomTargetInput = typeof PeerRoomTargetInput.Type;

/** A name in a message, with its delivery when it names an agent: a person has none. */
export const PeerRoomTarget = Schema.Struct({
  /** `person` or `agent`. */
  kind: Schema.String,
  email: Schema.String,
  /** One of `PEER_ROOM_DELIVERY_STATES`. */
  state: Schema.optional(Schema.String),
  /** The computer that acts on it, once it is passed. */
  environment: Schema.optional(Schema.String),
  run: Schema.optional(Schema.String),
  harness: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  /** The person who passed it on; an own message and a team-reach delivery have none. */
  by: Schema.optional(Schema.String),
  at: Schema.optional(Schema.String),
});
export type PeerRoomTarget = typeof PeerRoomTarget.Type;

export const PeerRoomAuthor = Schema.Struct({
  email: Schema.String,
  /** Set on an agent's post. */
  run: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
});
export type PeerRoomAuthor = typeof PeerRoomAuthor.Type;

/** One message of a room; `seq` is what people and agents type (`#12`). */
export const PeerRoomMessage = Schema.Struct({
  seq: Schema.Number,
  task: Schema.String,
  at: Schema.String,
  author: PeerRoomAuthor,
  text: Schema.String,
  replyTo: Schema.optional(Schema.Number),
  anchor: Schema.optional(PeerRoomAnchor),
  to: Schema.Array(PeerRoomTarget),
});
export type PeerRoomMessage = typeof PeerRoomMessage.Type;

/** A run's reach as a room shows it. */
export const PeerRoomReach = Schema.Struct({
  run: Schema.String,
  /** `own` or `team`. */
  reach: Schema.String,
  email: Schema.optional(Schema.String),
  /** `personal` or `shared`. */
  capacity: Schema.optional(Schema.String),
});
export type PeerRoomReach = typeof PeerRoomReach.Type;

/** A room as a reader sees it: the newest sequence, what they have seen, messages after `after`. */
export const PeerRoomRead = Schema.Struct({
  seq: Schema.Number,
  seen: Schema.Number,
  messages: Schema.Array(PeerRoomMessage),
  reaches: Schema.Array(PeerRoomReach),
  /** This computer's word, never the Hub's: it has a checkout of the project. */
  hasCheckout: Schema.optional(Schema.Boolean),
  /** This computer's word too: what carries its person's runs on the task, by run. */
  capacities: Schema.optional(Schema.Record(Schema.String, PeerRoomCapacity)),
});
export type PeerRoomRead = typeof PeerRoomRead.Type;

/** A message and where it is, as `/rooms/inbox` lists it. */
export const PeerRoomInboxItem = Schema.Struct({
  project: Schema.String,
  task: Schema.String,
  message: PeerRoomMessage,
});
export type PeerRoomInboxItem = typeof PeerRoomInboxItem.Type;

/** `project` → `task` → the room's newest sequence. */
export const PeerRoomSeqs = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, Schema.Number),
);
export type PeerRoomSeqs = typeof PeerRoomSeqs.Type;

/**
 * `project` → `task` → the room's revision. `seq` counts messages; this also moves with every
 * delivery's move, which adds none, so it is what an open room refetches on.
 */
export const PeerRoomRevs = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, Schema.Number),
);
export type PeerRoomRevs = typeof PeerRoomRevs.Type;

export const PeerRoomInbox = Schema.Struct({
  waiting: Schema.Array(PeerRoomInboxItem),
  mentions: Schema.Array(PeerRoomInboxItem),
  /** The deliveries this environment acts on, `passed` or `taken`. */
  work: Schema.Array(PeerRoomInboxItem),
  seqs: PeerRoomSeqs,
  revs: PeerRoomRevs,
});
export type PeerRoomInbox = typeof PeerRoomInbox.Type;

/** What waits on the person, clipped for the status (`PEER_ROOMS_STATUS_LIMITS`). */
export const PeerRoomNeed = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  task: Schema.String,
  seq: Schema.Number,
  author: Schema.String,
  /** The author's agent wrote it. */
  agent: Schema.optional(Schema.Boolean),
  text: Schema.String,
  /** `text` is the start of a longer message. */
  cut: Schema.optional(Schema.Boolean),
  at: Schema.String,
});
export type PeerRoomNeed = typeof PeerRoomNeed.Type;

export const PEER_ROOMS_STATUS_LIMITS = { text: 200, items: 32 } as const;

/** The plugin's status slice, read on every publish: what waits, and each room's newest sequence. */
export const PeerRoomsStatus = Schema.Struct({
  waiting: Schema.Array(PeerRoomNeed),
  mentions: Schema.Array(PeerRoomNeed),
  /** `workspace` → `project` → `task` → sequence, so a client knows what moved without polling. */
  seqs: Schema.Record(Schema.String, PeerRoomSeqs),
  /** `workspace` → `project` → `task` → revision, keyed as `seqs`. */
  revs: Schema.Record(Schema.String, PeerRoomRevs),
});
export type PeerRoomsStatus = typeof PeerRoomsStatus.Type;

const RoomPlace = {
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  task: TrimmedNonEmptyString,
};

export const PeerRoomsPlace = Schema.Struct(RoomPlace);
export type PeerRoomsPlace = typeof PeerRoomsPlace.Type;

export const PeerRoomsReadInput = Schema.Struct({
  ...RoomPlace,
  after: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
});
export type PeerRoomsReadInput = typeof PeerRoomsReadInput.Type;

/** A person's post. The environment comes from the server, and a person's post names no run. */
export const PeerRoomsPostInput = Schema.Struct({
  ...RoomPlace,
  /** The same `op` posts once. */
  op: TrimmedNonEmptyString,
  text: Schema.String,
  to: Schema.Array(PeerRoomTargetInput),
  anchor: Schema.optional(PeerRoomAnchor),
  replyTo: Schema.optional(Schema.Number),
});
export type PeerRoomsPostInput = typeof PeerRoomsPostInput.Type;

export const PeerRoomsSeenInput = Schema.Struct({ ...RoomPlace, seq: Schema.Number });
export type PeerRoomsSeenInput = typeof PeerRoomsSeenInput.Type;

export const PeerRoomsSeenResult = Schema.Struct({ seen: Schema.Number });
export type PeerRoomsSeenResult = typeof PeerRoomsSeenResult.Type;

/** Its owner passes a delivery on, or tries a failed one again. */
export const PeerRoomsPassInput = Schema.Struct({
  ...RoomPlace,
  seq: Schema.Number,
  /** The state the person saw, so a moved delivery is refused rather than moved again. */
  expect: Schema.optional(Schema.String),
});
export type PeerRoomsPassInput = typeof PeerRoomsPassInput.Type;

export const PeerRoomsDeclineInput = Schema.Struct({
  ...RoomPlace,
  seq: Schema.Number,
  reason: Schema.optional(Schema.String),
  expect: Schema.optional(Schema.String),
});
export type PeerRoomsDeclineInput = typeof PeerRoomsDeclineInput.Type;

export const PeerRoomsWithdrawInput = Schema.Struct({ ...RoomPlace, seq: Schema.Number });
export type PeerRoomsWithdrawInput = typeof PeerRoomsWithdrawInput.Type;

/** A run's person sets its reach. The capacity comes from this computer, never from a client. */
export const PeerRoomsSetReachInput = Schema.Struct({
  workspace: TrimmedNonEmptyString,
  project: TrimmedNonEmptyString,
  run: TrimmedNonEmptyString,
  reach: PeerRoomReachValue,
});
export type PeerRoomsSetReachInput = typeof PeerRoomsSetReachInput.Type;

/** The Hub answers with the row it stored, as a room shows it. */
export const PeerRoomsSetReachResult = Schema.Struct({ reach: PeerRoomReach });
export type PeerRoomsSetReachResult = typeof PeerRoomsSetReachResult.Type;

/** At most this much unified diff; `truncated` says it was cut. */
export const PEER_ROOM_DIFF_MAX_BYTES = 512 * 1024;

/** The task's diff, computed by git on this computer. The Hub never holds one. */
export const PeerRoomDiff = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("here"),
    /** This computer's run on the task, or a ref fetched from the remote. */
    source: Schema.Literals(["run", "pushed"]),
    base: Schema.String,
    head: Schema.String,
    patch: Schema.String,
    truncated: Schema.Boolean,
  }),
  Schema.Struct({
    state: Schema.Literal("notHere"),
    reason: Schema.String,
    /** The paths the Hub knows; they still take comments on a path. */
    files: Schema.Array(Schema.String),
  }),
]);
export type PeerRoomDiff = typeof PeerRoomDiff.Type;
