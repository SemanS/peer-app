/** Identities and deadlines shared by Peer clients and the local alert publisher. */
import * as Schema from "effect/Schema";
import { isSettleHandover } from "./settle.ts";

export const NEEDS_YOU_KINDS = [
  "thread",
  "agent",
  "request",
  "overlap",
  "stale",
  "owner-call",
] as const;
export type NeedsYouKind = (typeof NEEDS_YOU_KINDS)[number];
/**
 * The kinds that alert a phone: a thread is on the computer already, and an owner's call alerts no
 * one yet (phone alerts for it are the needs-you plugin's to add).
 */
export type NeedsYouAlertKind = Exclude<NeedsYouKind, "thread" | "owner-call">;
const key = (kind: NeedsYouKind, parts: ReadonlyArray<string>) =>
  `${kind}:${parts.map(encodeURIComponent).join("/")}`;
export const needsYouKey = {
  thread: (environment: string, thread: string) => key("thread", [environment, thread]),
  agent: (environment: string, agent: string) => key("agent", [environment, agent]),
  request: (workspace: string, request: string) => key("request", [workspace, request]),
  overlap: (workspace: string, project: string, overlap: string) =>
    key("overlap", [workspace, project, overlap]),
  stale: (environment: string, session: string) => key("stale", [environment, session]),
  ownerCall: (workspace: string, project: string, call: string) =>
    key("owner-call", [workspace, project, call]),
};
export const NEEDS_YOU_PUSH_PREFIX = "peer-needs-you.";
const pushPattern = /^peer-needs-you\.(agent|request|overlap|stale)\.[a-f0-9]{16}$/;
export const isNeedsYouPushId = (id: string): boolean => pushPattern.test(id);

/** FNV-1a over UTF-8 bytes; no Node or browser-only encoder is needed on mobile. */
export function needsYouPushId(itemKey: string): string | null {
  const kind = itemKey.slice(0, itemKey.indexOf(":"));
  if (!["agent", "request", "overlap", "stale"].includes(kind)) return null;
  let hash = 0xcbf29ce484222325n;
  const byte = (value: number) => {
    hash = BigInt.asUintN(64, (hash ^ BigInt(value)) * 0x100000001b3n);
  };
  for (const character of itemKey) {
    const cp = character.codePointAt(0)!;
    if (cp < 0x80) byte(cp);
    else if (cp < 0x800) {
      byte(0xc0 | (cp >> 6));
      byte(0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      byte(0xe0 | (cp >> 12));
      byte(0x80 | ((cp >> 6) & 0x3f));
      byte(0x80 | (cp & 0x3f));
    } else {
      byte(0xf0 | (cp >> 18));
      byte(0x80 | ((cp >> 12) & 0x3f));
      byte(0x80 | ((cp >> 6) & 0x3f));
      byte(0x80 | (cp & 0x3f));
    }
  }
  return `${NEEDS_YOU_PUSH_PREFIX}${kind}.${hash.toString(16).padStart(16, "0")}`;
}

export const OVERLAP_RECENT_MS = 2 * 60 * 1000;
export const OVERLAP_ASKED_MS = 3 * 60 * 1000;
export const OVERLAP_SETTLED_MS = 10 * 60 * 1000;
export const STALE_INPUT_WAIT_MS = 2 * 60 * 1000;
export const PERSON_OVERLAP_RESOLUTION = "Closed by a person in Peer";
export type OverlapAttention =
  | "settled"
  | "requested"
  | "unanswered"
  | "recent"
  | "decide"
  | "quiet";

type OverlapNote = {
  readonly at: string;
  readonly session?: string | undefined;
  readonly text?: string | undefined;
};

export function overlapHandover<Note extends OverlapNote>(
  notes: ReadonlyArray<Note>,
): Note | undefined {
  return notes.findLast(
    (note) => note.session === undefined && note.text !== undefined && isSettleHandover(note.text),
  );
}

export function overlapLastProposal(notes: ReadonlyArray<OverlapNote>): string | undefined {
  return notes.findLast((note) => note.session !== undefined)?.text;
}

/**
 * `atWork` is the sessions the caller sees at work; without it the agents count as present, which
 * is what callers before the settle plugin assumed.
 */
export function overlapAttention(
  overlap: {
    readonly state: "open" | "resolved";
    readonly updatedAt: string;
    readonly filesAt?: string | undefined;
    readonly askedAt?: string | undefined;
    readonly notes: ReadonlyArray<OverlapNote>;
    readonly policy?: string | undefined;
    readonly sessions?: ReadonlyArray<string> | undefined;
  },
  nowMs: number,
  atWork?: ReadonlySet<string> | ReadonlyArray<string>,
): OverlapAttention {
  if (overlap.state === "resolved") return "settled";
  const handover = overlapHandover(overlap.notes);
  // An agent that wrote after the handover (resumed late, or reopened) took the overlap back.
  const handedAt =
    handover !== undefined &&
    overlap.notes
      .slice(overlap.notes.indexOf(handover) + 1)
      .every((note) => note.session === undefined)
      ? Date.parse(handover.at)
      : undefined;
  const present = atWork === undefined ? undefined : new Set(atWork);
  const gone =
    present !== undefined &&
    overlap.sessions !== undefined &&
    !overlap.sessions.some((session) => present.has(session));
  if (handedAt !== undefined || gone) {
    // Only a person asking again after the handover waits for an answer; nobody else is left to.
    if (
      overlap.askedAt !== undefined &&
      handedAt !== undefined &&
      Date.parse(overlap.askedAt) > handedAt
    )
      return nowMs - Date.parse(overlap.askedAt) < OVERLAP_ASKED_MS ? "requested" : "unanswered";
    return "decide";
  }
  if (overlap.askedAt !== undefined)
    return nowMs - Date.parse(overlap.askedAt) < OVERLAP_ASKED_MS ? "requested" : "unanswered";
  const changedAt = Math.max(
    Date.parse(overlap.updatedAt),
    Date.parse(overlap.filesAt ?? overlap.updatedAt),
    ...overlap.notes.map((note) => Date.parse(note.at)),
  );
  if (nowMs - changedAt < OVERLAP_RECENT_MS) return "recent";
  return overlap.policy === "ask" ? "decide" : "quiet";
}

export const PeerStaleInput = Schema.Struct({
  session: Schema.String,
  since: Schema.String,
  scopes: Schema.Array(
    Schema.Struct({
      scope: Schema.String,
      readVersion: Schema.Number,
      currentVersion: Schema.NullOr(Schema.Number),
    }),
  ),
});
export type PeerStaleInput = typeof PeerStaleInput.Type;
export const PeerNeedsYouStatus = Schema.Struct({
  alerts: Schema.Struct({
    enabled: Schema.Boolean,
    delivery: Schema.Literals(["ready", "not-linked", "publishing-off"]),
  }),
  staleInputs: Schema.Array(PeerStaleInput),
});
export type PeerNeedsYouStatus = typeof PeerNeedsYouStatus.Type;
export const PeerNeedsYouSetAlertsInput = Schema.Struct({ enabled: Schema.Boolean });
export type PeerNeedsYouSetAlertsInput = typeof PeerNeedsYouSetAlertsInput.Type;
export const PeerHubSubscribeInput = Schema.Struct({
  scope: Schema.optional(Schema.Literal("needs-you")),
});
export type PeerHubSubscribeInput = typeof PeerHubSubscribeInput.Type;
