/**
 * Peer's settle plugin: when an agent ends with an open overlap it was to close, this computer
 * resumes its conversation once, and otherwise hands the overlap to the person with a note. The
 * handover and the person's closing are recognisable texts, like the settle request, so the Hub
 * keeps no field for them and an older app reads them as plain notes.
 */
import * as Schema from "effect/Schema";

export const PEER_SETTLE_PLUGIN = {
  id: "settle",
  title: "Settle overlaps",
  summary:
    "Resume an ended agent once to close its open overlap, and otherwise hand the overlap to you.",
} as const;

/** `settle.resume` is on unless the person turned it off on this computer. */
export const SETTLE_RESUME_DEFAULT = true;
export const PeerSettleSetResumeInput = Schema.Struct({ enabled: Schema.Boolean });
export type PeerSettleSetResumeInput = typeof PeerSettleSetResumeInput.Type;

export const PeerSettleAttempt = Schema.Struct({
  overlap: Schema.String,
  workspace: Schema.String,
  project: Schema.String,
  session: Schema.String,
  since: Schema.String,
});
export type PeerSettleAttempt = typeof PeerSettleAttempt.Type;
export const PeerSettleStatus = Schema.Struct({
  resume: Schema.Boolean,
  /** Resumptions running now, so the overlap page can say "Resuming…" instead of offering buttons. */
  attempts: Schema.Array(PeerSettleAttempt),
});
export type PeerSettleStatus = typeof PeerSettleStatus.Type;

export const SETTLE_HANDOVER_REASONS = {
  off: "resumption is off on this computer",
  "no-resume": "no resumption for this adapter",
  "not-found": "conversation not found",
  failed: "resume failed",
  timeout: "resume ran out of time",
  "ended-again": "the agent ended again",
} as const;
export type SettleHandoverReason = keyof typeof SETTLE_HANDOVER_REASONS;

/** Every handover note starts with this; the agent's name follows, so the full shape is checked. */
export const SETTLE_HANDOVER = "Peer: ";
const HANDOVER_MIDDLE = " ended without closing this overlap and could not be resumed (";
const HANDOVER_END = "). It is yours to close in Peer.";

export const settleHandover = (input: {
  readonly agent: string;
  readonly reason: SettleHandoverReason;
}): string =>
  `${SETTLE_HANDOVER}${input.agent}${HANDOVER_MIDDLE}${SETTLE_HANDOVER_REASONS[input.reason]}${HANDOVER_END}`;

/** A person who types "Peer: …" in a note must not hand the overlap over by accident. */
export const isSettleHandover = (text: string): boolean =>
  text.startsWith(SETTLE_HANDOVER) && text.includes(HANDOVER_MIDDLE) && text.endsWith(HANDOVER_END);

export const CLOSED_AFTER_AGENTS_ENDED = "Closed in Peer after the agents ended.";
export const LAST_PROPOSAL_MAX = 300;

/** The resolution a person records, quoting the agents' last word so History shows what was proposed. */
export function closedAfterAgentsEnded(lastProposal: string | undefined): string {
  const proposal = lastProposal?.trim() ?? "";
  if (proposal === "") return CLOSED_AFTER_AGENTS_ENDED;
  const chars = [...proposal];
  const clipped =
    chars.length > LAST_PROPOSAL_MAX
      ? `${chars.slice(0, LAST_PROPOSAL_MAX - 1).join("")}…`
      : proposal;
  return `${CLOSED_AFTER_AGENTS_ENDED} Last proposal: "${clipped}"`;
}
