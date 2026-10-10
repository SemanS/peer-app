/**
 * ledger — what this computer remembers of the decision points it opened in Slack, and of the
 * answers it delivered and has not yet reported. A wait is named by its key while the key lasts; the
 * same key again after it closed (herdr repeats keys within a turn) is a new occurrence, which the
 * Hub knows as `key#n`.
 *
 * @module peerHub/plugins/slack/ledger
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as PeerState from "../../core/state/PeerState.ts";
import type { SlackWait } from "./waits.ts";

const Entry = Schema.Struct({
  workspace: Schema.String,
  /** When this occurrence was first seen; null between a closed occurrence and the next. */
  firstSeenAt: Schema.NullOr(Schema.String),
  opened: Schema.Boolean,
  /** The Hub says it is over: it is not opened again. */
  closed: Schema.Boolean,
  occurrence: Schema.Number,
});
const Outcome = Schema.Struct({
  workspace: Schema.String,
  result: Schema.Literals(["delivered", "stale", "failed"]),
  reason: Schema.optional(Schema.String),
});
const Ledger = Schema.Struct({
  waits: Schema.Record(Schema.String, Entry),
  delivered: Schema.Record(Schema.String, Outcome),
});
export type Entry = typeof Entry.Type;
export type Outcome = typeof Outcome.Type;
type Ledger = typeof Ledger.Type;

const EMPTY: Ledger = { waits: {}, delivered: {} };
/** Closed keys kept between occurrences. */
const KEPT = 200;

export const millis = (iso: string) =>
  Option.match(DateTime.make(iso), { onNone: () => 0, onSome: DateTime.toEpochMillis });
/** The key the Hub knows an occurrence by. */
export const hubKey = (key: string, e: Entry) =>
  e.occurrence === 1 ? key : `${key}#${e.occurrence}`;
/** An opened wait that is over: its next occurrence is the next number. */
export const over = (e: Entry): Entry => ({
  ...e,
  firstSeenAt: null,
  opened: false,
  closed: false,
  occurrence: e.occurrence + 1,
});

/**
 * The ledger after a look at the waits open now (`wanted`) in the workspaces `known`: a wait seen
 * the first time, or the key of a closed one seen again, starts an occurrence; one that is gone
 * leaves nothing if it was never opened, else its place between occurrences. An opened one that is
 * not closed stays until the Hub is told it is over.
 */
export function observe(
  ledger: Ledger,
  wanted: ReadonlyArray<SlackWait>,
  known: ReadonlySet<string>,
  now: number,
) {
  const at = DateTime.formatIso(DateTime.makeUnsafe(now));
  const waits = { ...ledger.waits };
  for (const { waitKey: key, workspace } of wanted) {
    const e = waits[key];
    if (e === undefined) {
      waits[key] = { workspace, firstSeenAt: at, opened: false, closed: false, occurrence: 1 };
    } else if (e.firstSeenAt === null) waits[key] = { ...e, workspace, firstSeenAt: at };
  }
  const open = new Set(wanted.map((wait) => wait.waitKey));
  for (const [key, e] of Object.entries(waits)) {
    if (open.has(key) || e.firstSeenAt === null || !known.has(e.workspace)) continue;
    if (e.opened && !e.closed) continue;
    if (!e.opened && e.occurrence === 1) delete waits[key];
    else waits[key] = e.opened ? over(e) : { ...e, firstSeenAt: null };
  }
  const between = Object.keys(waits).filter((key) => waits[key]?.firstSeenAt === null);
  for (const key of between.slice(0, -KEPT)) delete waits[key];
  const same = Object.keys(waits).length === Object.keys(ledger.waits).length;
  return same && Object.entries(waits).every(([key, e]) => ledger.waits[key] === e)
    ? ledger
    : { ...ledger, waits };
}

/** The slack slice of `peer-hub.json`. Writers hold the state lock, or run under it. */
export const slackLedger = (state: PeerState.PeerState["Service"]) => {
  const slice = state.pluginData("slack", Ledger);
  return {
    read: slice.read.pipe(Effect.map(Option.getOrElse(() => EMPTY))),
    update: (f: (ledger: Ledger) => Ledger) =>
      slice.update((current) => f(Option.getOrElse(current, () => EMPTY))),
  };
};
export type SlackLedger = ReturnType<typeof slackLedger>;
