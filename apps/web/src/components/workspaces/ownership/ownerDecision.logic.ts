/**
 * The card of an owner's call in Needs you and the dialog that accepts or declines it: who may do
 * what with a call (the client runtime's `callActions`, as the Hub decides it), what a decision
 * sends, and how a call reads to the person it waits on. Pure, with `now` passed in.
 */
import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";
import {
  callActions,
  type CallActions,
  type ProjectOwnership,
} from "@t3tools/client-runtime/peer/ownership";
import {
  PEER_OWNERSHIP_LIMITS,
  type PeerOwnerCall,
  type PeerOwnershipDecideInput,
  type PeerOwnershipDecision,
} from "@t3tools/contracts";

import { agoLabel } from "../task/taskTime.logic";
import { expiresLabel, pathsText } from "./ownerCall.logic";

/** The longest note a decision carries: the Hub cuts nothing, it refuses a longer one. */
export const NOTE_MAX = PEER_OWNERSHIP_LIMITS.textChars;

/** How many characters a note holds, counted as the Hub counts them: Unicode scalar values. */
export const noteLength = (note: string): number => [...note].length;

/** A note cut to what the Hub accepts, so what the person typed is never refused for its length. */
export function clampNote(note: string): string {
  const characters = [...note];
  return characters.length <= NOTE_MAX ? note : characters.slice(0, NOTE_MAX).join("");
}

/**
 * What accepting or declining sends: the call, the decision, and the note the person wrote (left
 * out when empty). The Hub records who decided, and for whom.
 */
export function decideInput(input: {
  readonly workspace: string;
  readonly project: string;
  readonly call: Pick<PeerOwnerCall, "id">;
  readonly decision: PeerOwnershipDecision;
  readonly note: string;
}): PeerOwnershipDecideInput {
  const note = clampNote(input.note.trim());
  return {
    workspace: input.workspace,
    project: input.project,
    id: input.call.id,
    decision: input.decision,
    ...(note === "" ? {} : { note }),
  };
}

// ---- the card in Needs you ---------------------------------------------------------------------------

type OwnerCallItem = Extract<NeedsYouItem, { readonly kind: "owner-call" }>;

/** How the person stands to a call: they decide it, decide it for an owner, opened it, or it is over. */
export type OwnerCallStand = "decide" | "on-behalf" | "own" | "closed";

/** What the card in Needs you says and offers. */
export interface OwnerCallCardModel {
  readonly stand: OwnerCallStand;
  readonly title: string;
  readonly paths: ReadonlyArray<string>;
  /** What the asking agent said it needs the change for. */
  readonly reason: string;
  /** "Bob's agent's words · 40 min ago · expires in 6 days". */
  readonly meta: string;
  /** What the card explains: a lead decides for an owner, or you cannot decide your own call. */
  readonly explanation: string | undefined;
  /** "Accept…", "Accept for Ana…", a disabled "Accept"; undefined once there is nothing to accept. */
  readonly accept: { readonly label: string; readonly disabled: boolean } | undefined;
  readonly decline: { readonly label: string } | undefined;
  /** Their own agent opened it and it still waits: they take it back. */
  readonly withdraw: boolean;
}

/**
 * The card of an owner's call, for the person it waits on. What they may do comes from
 * `callActions`: the owner decides, a lead decides for an owner on their behalf, nobody decides a
 * call their own agent opened (that one offers Accept disabled, with why, and Withdraw), and a call
 * that is decided, withdrawn or expired offers nothing.
 */
export function ownerCallCard(input: {
  readonly ownership: ProjectOwnership | undefined;
  readonly item: Pick<OwnerCallItem, "call" | "asker" | "owner" | "onBehalf" | "title">;
  readonly now: number;
}): OwnerCallCardModel {
  const { ownership, item, now } = input;
  const { call } = item;
  const actions: CallActions =
    ownership === undefined
      ? { decide: item.onBehalf ? "on-behalf" : "owner", withdraw: false }
      : callActions(ownership, call, now);
  const stand: OwnerCallStand =
    actions.decide === "owner"
      ? "decide"
      : actions.decide === "on-behalf"
        ? "on-behalf"
        : actions.withdraw
          ? "own"
          : "closed";
  const mine = stand === "own";
  const words = `${mine ? "Your agent" : `${item.asker}'s agent`}'s words`;
  const expires = expiresLabel(call.expiresAt, now);
  const asked = agoLabel(call.createdAt, now);
  return {
    stand,
    title: mine ? `Your agent asked ${item.owner} to change their path` : item.title,
    paths: call.paths,
    reason: call.reason,
    meta: [words, asked === "" ? undefined : asked, expires]
      .filter((part) => part !== undefined)
      .join(" · "),
    explanation:
      stand === "on-behalf"
        ? `As a lead you can decide on ${item.owner}'s behalf. The record says you decided for ${item.owner}.`
        : stand === "own"
          ? `You can't decide a call your own agent opened. ${item.owner} decides it, or another lead or an admin.`
          : stand === "closed"
            ? "This call is no longer pending."
            : undefined,
    accept:
      stand === "decide"
        ? { label: "Accept…", disabled: false }
        : stand === "on-behalf"
          ? { label: `Accept for ${item.owner}…`, disabled: false }
          : stand === "own"
            ? { label: "Accept", disabled: true }
            : undefined,
    decline:
      stand === "decide"
        ? { label: "Decline…" }
        : stand === "on-behalf"
          ? { label: `Decline for ${item.owner}…` }
          : undefined,
    withdraw: mine,
  };
}

// ---- the dialog that decides --------------------------------------------------------------------------

/** What the decision dialog says. */
export interface DecisionCopy {
  readonly title: string;
  readonly body: string;
  /** Set on a lead's decision for an owner: what the record will say. */
  readonly onBehalf: string | undefined;
  readonly noteLabel: string;
  readonly confirm: string;
  readonly busy: string;
}

/**
 * The words of the dialog that accepts or declines a call with a note: what happens to the asking
 * agent, and for a lead deciding for an owner, that the record says so.
 */
export function decisionCopy(input: {
  readonly decision: PeerOwnershipDecision;
  /** The person whose agent asked, and the owner it asked, by name. */
  readonly asker: string;
  readonly owner: string;
  readonly onBehalf: boolean;
  readonly paths: ReadonlyArray<string>;
  /** The task it is about, as the lists write it ("ORD-9"); undefined for a call on no task. */
  readonly task: string | undefined;
}): DecisionCopy {
  const { decision, asker, owner, onBehalf } = input;
  const where = pathsText(input.paths);
  const accepting = decision === "accept";
  const call = `${asker}'s agent's call${onBehalf ? ` for ${owner}` : ""}`;
  return {
    title: `${accepting ? "Accept" : "Decline"} ${call}?`,
    body: accepting
      ? `Its edits of ${where}${input.task === undefined ? "" : ` for ${input.task}`} will go ahead. It is woken and reads your note.`
      : `Its edits of ${where} stay stopped. It reads your note and can ask again.`,
    onBehalf: onBehalf ? `The record says you decided for ${owner}.` : undefined,
    noteLabel: `Note for ${asker}'s agent (optional)`,
    confirm: `${accepting ? "Accept" : "Decline"}${onBehalf ? ` for ${owner}` : ""}`,
    busy: accepting ? "Accepting…" : "Declining…",
  };
}
