/**
 * What the phone adds to the shared room logic in `@t3tools/client-runtime/peer/rooms`: the plain
 * composer's two targets, a draft that lives until its delivery is confirmed, a message as one row,
 * and Needs you across computers. Delivery words and who may do what stay in the runtime.
 */
import {
  personName,
  taskLabel,
  type NeedsYouEnvironment,
} from "@t3tools/client-runtime/peer/needs-you";
import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import {
  anchorText,
  availableActions,
  deliveryWords,
  needsYouByTask,
  roomBadgeCount,
  roomNeedsYou,
  type NameOf,
  type RoomAction,
  type RoomNeedsYouItem,
  type RoomPlace,
  type RoomTargetChoice,
} from "@t3tools/client-runtime/peer/rooms";
import { harnessName } from "@t3tools/client-runtime/peer/work";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PeerRoomMessage,
  PeerRoomRead,
  PeerRoomsDeclineInput,
  PeerRoomsPostInput,
} from "@t3tools/contracts";

/** The newest messages the phone reads: a room holds 1,000, each up to 4,000 characters. */
export const ROOM_READ_LIMIT = 100;

/** D13: the phone writes to the team or to the person's own agent, not to colleagues. */
export const composerChoices = (targets: ReadonlyArray<RoomTargetChoice>) =>
  targets.filter((target) => target.kind === "team" || target.kind === "own-agent");

/** The chosen target; a choice that is gone falls back to the first, which is Team. */
export const chosenTarget = (
  choices: ReadonlyArray<RoomTargetChoice>,
  key: string,
): RoomTargetChoice | undefined => choices.find((choice) => choice.key === key) ?? choices[0];

/**
 * Whether Send works, and why not when there is something to say. A disabled target blocks the send
 * and never falls back to Team: words meant for the person's own agent must not reach the team.
 */
export function composerState(input: {
  readonly text: string;
  readonly sending: boolean;
  readonly allowed: boolean;
  readonly me: string | null | undefined;
  readonly target: RoomTargetChoice | undefined;
}): { readonly canSend: boolean; readonly reason: string | null } {
  const reason =
    input.me === null || input.me === undefined
      ? "Sign in to Peer Hub on the computer to write here."
      : !input.allowed
        ? "This device cannot write to rooms on this computer."
        : (input.target?.disabled ?? null);
  return {
    canSend:
      reason === null && !input.sending && input.target !== undefined && input.text.trim() !== "",
    reason,
  };
}

/** A send in flight or unconfirmed. Its `op` is what makes sending it again post it once. */
export interface RoomPendingSend {
  readonly op: string;
  readonly text: string;
  readonly target: string;
}

export interface RoomDraft {
  readonly text: string;
  readonly target: string;
  readonly sending: boolean;
  readonly pending: RoomPendingSend | null;
  readonly notice: string | null;
}

export const EMPTY_ROOM_DRAFT: RoomDraft = {
  text: "",
  target: "team",
  sending: false,
  pending: null,
  notice: null,
};

/**
 * Starts a send. The same words to the same target reuse the unconfirmed send's `op`, so the Hub
 * adds nothing if the first one landed; changed words are a new message and need a new `op`, since
 * a repeated `op` would answer with the first message and drop the change.
 */
export function beginSend(draft: RoomDraft, newOp: () => string): RoomDraft {
  const text = draft.text.trim();
  const same = draft.pending?.text === text && draft.pending?.target === draft.target;
  const op = same && draft.pending !== null ? draft.pending.op : newOp();
  return { ...draft, sending: true, notice: null, pending: { op, text, target: draft.target } };
}

export type RoomCommandEnd<A> =
  | { readonly kind: "done"; readonly value: A }
  | { readonly kind: "unknown" }
  | { readonly kind: "failed"; readonly message: string };

export const UNCONFIRMED_SEND =
  "The send could not be confirmed. Your message is still here, and sending it again posts it once.";

/** Only a confirmed post clears the draft: a refusal or an unknown result keeps every word. */
export function afterSend(draft: RoomDraft, end: RoomCommandEnd<unknown>): RoomDraft {
  if (end.kind === "done") return EMPTY_ROOM_DRAFT;
  return {
    ...draft,
    sending: false,
    notice: end.kind === "unknown" ? UNCONFIRMED_SEND : end.message,
  };
}

/** What a send posts; `post` takes no environment or run, the server fills them. */
export const postInput = (
  place: RoomPlace,
  pending: RoomPendingSend,
  to: RoomTargetChoice["to"],
): PeerRoomsPostInput => ({ ...place, op: pending.op, text: pending.text, to });

const MOVED = "This has moved on. The room shows where it stands now.";

/** A refusal in plain words; a stale move says so rather than repeat the Hub's wire text. */
export function roomFailureWords(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    if (cause.code === "stale_delivery") return MOVED;
  }
  const message = cause instanceof Error ? cause.message.trim() : "";
  return message === "" ? "That did not go through." : message;
}

/** An atom command's end: confirmed, refused, or interrupted with its outcome unknown. */
export function roomCommandEnd<A, E>(result: AtomCommandResult<A, E>): RoomCommandEnd<A> {
  if (result._tag === "Success") return { kind: "done", value: result.value };
  if (isAtomCommandInterrupted(result)) return { kind: "unknown" };
  return { kind: "failed", message: roomFailureWords(squashAtomCommandFailure(result)) };
}

export const ROOM_ACTION_WORDS: Readonly<Record<RoomAction, string>> = {
  pass: "Pass on",
  decline: "Decline",
  withdraw: "Withdraw",
  tryAgain: "Try again",
};

/** Said after a move whose answer never came. */
export const UNCONFIRMED_MOVE = "That could not be confirmed. Check the room before trying again.";

/** A decline's input: no reason when the person gave none, and the state they saw. */
export function declineInput(
  place: RoomPlace,
  seq: number,
  reason: string,
  expect: string,
): PeerRoomsDeclineInput {
  const said = reason.trim();
  return { ...place, seq, expect, ...(said === "" ? {} : { reason: said }) };
}

export interface RoomMessageView {
  readonly key: string;
  readonly seq: number;
  readonly at: string;
  readonly author: string;
  readonly fromAgent: boolean;
  readonly text: string;
  readonly reply: string | null;
  /** `path:line`: the phone has no diff to show it in. */
  readonly anchor: string | null;
  /** The people the message names. */
  readonly names: string | null;
  readonly deliveries: ReadonlyArray<{
    readonly key: string;
    readonly words: string;
    readonly state: string;
    readonly actions: ReadonlyArray<RoomAction>;
  }>;
}

/** One message as a row. */
export function messageView(
  message: PeerRoomMessage,
  context: {
    readonly me: string | null | undefined;
    readonly nameOf: NameOf;
    readonly now?: number;
  },
): RoomMessageView {
  const { me, nameOf, now = Date.now() } = context;
  const mine = message.author.email.toLowerCase() === me?.toLowerCase();
  const person = mine ? "You" : nameOf(message.author.email);
  const fromAgent = message.author.run !== undefined || message.author.agent !== undefined;
  const agentName = harnessName(message.author.agent) ?? message.author.agent;
  const agentLabel = `${mine ? "Your" : `${person}'s`} agent`;
  const people = message.to.filter((target) => target.kind === "person");
  return {
    key: String(message.seq),
    seq: message.seq,
    at: message.at,
    author: fromAgent
      ? agentName === undefined
        ? agentLabel
        : `${agentLabel} · ${agentName}`
      : person,
    fromAgent,
    text: message.text,
    reply: message.replyTo === undefined ? null : `Reply to #${message.replyTo}`,
    anchor: message.anchor === undefined ? null : anchorText(message.anchor),
    names:
      people.length === 0
        ? null
        : `For ${people
            .map((target) =>
              target.email.toLowerCase() === me?.toLowerCase() ? "you" : nameOf(target.email),
            )
            .join(", ")}`,
    deliveries: message.to.flatMap((target) => {
      const words = deliveryWords(target, { me, nameOf, now });
      if (words === null) return [];
      const actions = availableActions(message, target, me, now);
      return [{ key: target.email, words, state: target.state ?? "", actions }];
    }),
  };
}

/** The read's messages with the Hub's answers since; a newer read replaces them. */
export function withMessage(read: PeerRoomRead, message: PeerRoomMessage): PeerRoomRead {
  const others = read.messages.filter((row) => row.seq !== message.seq);
  return {
    ...read,
    seq: Math.max(read.seq, message.seq),
    messages: [...others, message].sort((a, b) => a.seq - b.seq),
  };
}

/** The sequence to mark seen, or null when the read holds nothing newer than was marked. */
export function seenToSend(
  read: Pick<PeerRoomRead, "seq" | "seen"> | null,
  sent: number,
): number | null {
  if (read === null || read.seq <= read.seen || read.seq <= sent) return null;
  return read.seq;
}

/** Whether the read stopped at the phone's limit with older messages left out. */
export const olderLeftOut = (messages: ReadonlyArray<Pick<PeerRoomMessage, "seq">>) =>
  messages.length >= ROOM_READ_LIMIT && (messages[0]?.seq ?? 1) > 1;

/** Within this of the end, a new message keeps the reader at the end. */
const AT_END = 96;

/** Whether a list is scrolled to its end, so a new message may move it. */
export const atEnd = (scroll: {
  readonly contentOffset: { readonly y: number };
  readonly contentSize: { readonly height: number };
  readonly layoutMeasurement: { readonly height: number };
}) => scroll.contentSize.height - scroll.layoutMeasurement.height - scroll.contentOffset.y < AT_END;

/** The count under a task's row; null with nothing waiting. */
export function roomBadgeText(...args: Parameters<typeof roomBadgeCount>): string | null {
  const count = roomBadgeCount(...args);
  return count === 0 ? null : `Room · ${count} ${count === 1 ? "needs" : "need"} you`;
}

/** A room's item in Needs you, with the computer it came from. */
export interface RoomNeed extends RoomNeedsYouItem {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly offline: boolean;
  readonly taskTitle: string;
  readonly projectName: string;
}

/**
 * Needs you's room items over every computer, newest first. Two computers of one person report the
 * same message, so it counts once and a connected computer answers for it. A computer where the
 * plugin is off adds nothing, whatever its status still carries.
 */
export function roomNeedsAcross(
  environments: ReadonlyArray<
    Pick<NeedsYouEnvironment, "environmentId" | "label" | "connected" | "status">
  >,
): ReadonlyArray<RoomNeed> {
  const seen = new Set<string>();
  const needs: RoomNeed[] = [];
  const connectedFirst = [...environments].sort(
    (a, b) => Number(b.connected) - Number(a.connected),
  );
  for (const environment of connectedFirst) {
    const { status } = environment;
    if (status === null || !status.signedIn || !activePlugin(status, "rooms")) continue;
    for (const item of roomNeedsYou(status.rooms, (need) =>
      personName(status, need.workspace, need.author),
    )) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      const project = status.workspaces
        .find((workspace) => workspace.slug === item.workspace)
        ?.projects.find((row) => row.project.id === item.project);
      const task = project?.work.tasks.find((row) => row.id === item.task);
      needs.push({
        ...item,
        environmentId: environment.environmentId,
        environmentLabel: environment.label,
        offline: !environment.connected,
        taskTitle: task === undefined ? item.task : taskLabel(task),
        projectName: project?.project.name ?? item.project,
      });
    }
  }
  return needs.sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq);
}

/** One card per task, so an owner asked ten times on a task sees one card. */
export const roomNeedGroups = (needs: ReadonlyArray<RoomNeed>) => needsYouByTask(needs);
