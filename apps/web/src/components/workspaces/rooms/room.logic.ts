/**
 * What the Room page decides for itself: which recipients a draft names, whether it can go, what
 * stays after a send, and how a message's author and deliveries read. The words and rules a phone
 * shares are in `client-runtime/peer/rooms`; this only composes them.
 */
import {
  lostStart,
  type NameOf,
  type RoomPlace,
  type RoomTargetChoice,
} from "@t3tools/client-runtime/peer/rooms";
import type { PeerRoomSnapshot } from "@t3tools/contracts";
import {
  PeerRoomAnchor,
  type PeerRoomCapacity,
  type PeerRoomMessage,
  type PeerRoomReach,
  type PeerRoomTarget,
  type PeerRoomTargetInput,
  type PeerRoomStep,
  type PeerRun,
} from "@t3tools/contracts";
import { harnessName } from "@t3tools/client-runtime/peer/work";
import * as Schema from "effect/Schema";

import type { SignalTone } from "../signals";

/** The Hub's bound on a message: more is refused with `bad_text`. */
export const ROOM_TEXT_MAX = 4_000;

/** The Hub's largest page; older messages are not on the page. */
export const ROOM_PAGE = 200;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A message being written, kept until the Hub confirms it. */
export interface RoomDraft {
  readonly text: string;
  /** The To row's chosen keys; none is Team, the default. */
  readonly selected: ReadonlyArray<string>;
  /** The agent and model chosen for Your agent; none keeps the person's default. */
  readonly agent?: RoomAgentChoice | undefined;
  readonly anchor?: PeerRoomAnchor | undefined;
  /** The operation of the last attempt: a retry of the same draft posts once. */
  readonly operation?: RoomOperation | undefined;
}

export interface RoomAgentChoice {
  readonly harness: string;
  readonly model: string;
  readonly label: string;
  readonly effort?: string | undefined;
}

const isAgentChoice = (value: unknown): value is RoomAgentChoice => {
  if (typeof value !== "object" || value === null) return false;
  const { harness, model, label, effort } = value as Record<string, unknown>;
  return (
    typeof harness === "string" &&
    typeof model === "string" &&
    typeof label === "string" &&
    (effort === undefined || typeof effort === "string")
  );
};

export interface RoomOperation {
  readonly draft: string;
  readonly id: string;
}

export const EMPTY_DRAFT: RoomDraft = { text: "", selected: [] };

const isAnchor = Schema.is(PeerRoomAnchor);

/** A stored draft, or the empty one when what was stored cannot be read. */
export function parseDraft(raw: string | null): RoomDraft {
  if (raw === null) return EMPTY_DRAFT;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_DRAFT;
  }
  if (typeof value !== "object" || value === null) return EMPTY_DRAFT;
  const { text, selected, agent, anchor, operation } = value as Record<string, unknown>;
  if (typeof text !== "string" || !Array.isArray(selected)) return EMPTY_DRAFT;
  const known =
    typeof operation === "object" &&
    operation !== null &&
    typeof (operation as RoomOperation).draft === "string" &&
    typeof (operation as RoomOperation).id === "string";
  return {
    text,
    selected: selected.filter((key): key is string => typeof key === "string"),
    ...(isAgentChoice(agent) ? { agent } : {}),
    ...(isAnchor(anchor) ? { anchor } : {}),
    ...(known ? { operation: operation as RoomOperation } : {}),
  };
}

export const isEmptyDraft = (draft: RoomDraft) =>
  draft.text === "" && draft.selected.length === 0 && draft.anchor === undefined;

export const draftStorageKey = (place: {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}) => `peer:room-draft:${place.workspace}/${place.project}/${place.task}`;

/** The keys the To row shows as chosen: Team stands for none. */
export const chosenKeys = (draft: Pick<RoomDraft, "selected">): ReadonlyArray<string> =>
  draft.selected.length === 0 ? ["team"] : draft.selected;

/** Picking Team clears the rest; any other chip joins or leaves. A disabled chip does nothing. */
export function toggleChoice(
  selected: ReadonlyArray<string>,
  choice: Pick<RoomTargetChoice, "key" | "kind" | "disabled">,
): ReadonlyArray<string> {
  if (choice.disabled !== undefined) return selected;
  if (choice.kind === "team") return [];
  return selected.includes(choice.key)
    ? selected.filter((key) => key !== choice.key)
    : [...selected, choice.key];
}

/** A project member the `@` list can name, chip or no chip. */
export interface RoomPerson {
  readonly key: string;
  readonly email: string;
  readonly label: string;
}

/** Everyone on the project but the writer: a mention need not be a person on the task. */
export function peopleOf(
  members: ReadonlyArray<{ readonly email: string; readonly name?: string | null | undefined }>,
  me: string,
  nameOf: NameOf,
): ReadonlyArray<RoomPerson> {
  return members
    .filter((member) => !same(member.email, me))
    .map((member) => ({
      key: `person:${member.email}`,
      email: member.email,
      label: nameOf(member.email),
    }));
}

/** The To row's chips, with a chosen person the task's list does not hold. */
export function choicesWithMentions(
  choices: ReadonlyArray<RoomTargetChoice>,
  people: ReadonlyArray<RoomPerson>,
  selected: ReadonlyArray<string>,
): ReadonlyArray<RoomTargetChoice> {
  const extra = people
    .filter((person) => selected.includes(person.key))
    .filter((person) => !choices.some((choice) => choice.key === person.key))
    .map((person): RoomTargetChoice => ({
      key: person.key,
      label: person.label,
      kind: "person",
      to: [{ kind: "person", email: person.email }],
    }));
  return [...choices, ...extra];
}

/** Who a draft names, and what the writer is told before sending. */
export function recipientsOf(
  choices: ReadonlyArray<RoomTargetChoice>,
  selected: ReadonlyArray<string>,
  agent?: RoomAgentChoice,
  chat = false,
): {
  readonly to: ReadonlyArray<PeerRoomTargetInput>;
  readonly notes: ReadonlyArray<string>;
  readonly blocked: string | null;
} {
  const chosen = choices.filter((choice) => selected.includes(choice.key));
  const gone = selected.some((key) => !choices.some((choice) => choice.key === key));
  const carries = (choice: RoomTargetChoice) =>
    agent !== undefined && choice.kind === "own-agent" && choice.disabled === undefined;
  return {
    to: chosen.flatMap((choice) =>
      carries(choice) && agent !== undefined
        ? choice.to.map((target) => ({
            ...target,
            harness: agent.harness,
            model: agent.model,
            ...(agent.effort === undefined ? {} : { effort: agent.effort }),
          }))
        : choice.to,
    ),
    notes: chosen.flatMap((choice) => {
      if (carries(choice) && agent !== undefined)
        return [
          `This starts ${agent.label}${agent.effort === undefined ? "" : ` at ${agent.effort} effort`} on this computer, ${chat ? "in its own checkout" : "read-only"}, on your capacity.`,
        ];
      return choice.note === undefined ? [] : [choice.note];
    }),
    // Sending without them would reach the team instead of the people this was written for.
    blocked: gone
      ? RECIPIENT_GONE
      : (chosen.find((choice) => choice.disabled !== undefined)?.disabled ?? null),
  };
}

const RECIPIENT_GONE = "Someone you chose is no longer on this task. Choose who this is for again.";

/** Who can start a room agent: what herdr runs, signed in here, and what the project allows. */
export function roomAgentEntries<
  Entry extends {
    readonly driverKind: string;
    readonly enabled: boolean;
    readonly isAvailable: boolean;
    readonly isDefault: boolean;
  },
>(entries: ReadonlyArray<Entry>, personalHarnesses: ReadonlyArray<string>): ReadonlyArray<Entry> {
  return entries.filter((entry) => {
    const harness = harnessOfDriver(entry.driverKind);
    return (
      harness !== null &&
      // Another instance's account would not reach the herdr session, which runs the plain CLI.
      entry.isDefault &&
      entry.enabled &&
      entry.isAvailable &&
      (personalHarnesses.length === 0 || personalHarnesses.includes(harness))
    );
  });
}

const EFFORT_OPTIONS = new Set(["effort", "reasoningEffort"]);

/**
 * The models with reasoning as their only option: a room start passes nothing else on, so the
 * picker offers nothing else.
 */
export function withEffortOnly<
  Model extends {
    readonly capabilities?:
      | {
          readonly optionDescriptors?: ReadonlyArray<{ readonly id: string }> | undefined;
        }
      | null
      | undefined;
  },
>(models: ReadonlyArray<Model>): ReadonlyArray<Model> {
  return models.map((model) => ({
    ...model,
    capabilities: {
      ...model.capabilities,
      optionDescriptors: model.capabilities?.optionDescriptors?.filter((option) =>
        EFFORT_OPTIONS.has(option.id),
      ),
    },
  }));
}

export const effortOptionOf = (harness: string) =>
  harness === "claude" ? "effort" : "reasoningEffort";

export const harnessOfDriver = (driverKind: string) =>
  driverKind === "claudeAgent" ? "claude" : driverKind === "codex" ? "codex" : null;

/** What keeps one message's move apart: a list of a person's rooms holds several `#1`s. */
export const moveKey = (place: RoomPlace, seq: number) =>
  `${place.workspace}/${place.project}/${place.task}:${seq}`;

/** Why a draft cannot go, or null. */
export function draftProblem(text: string, blocked: string | null): string | null {
  if (blocked !== null) return blocked;
  if (text.length > ROOM_TEXT_MAX) return "A message holds at most 4,000 characters.";
  return null;
}

export const canSend = (text: string, blocked: string | null) =>
  text.trim() !== "" && draftProblem(text, blocked) === null;

/** What makes two sends the same message. */
export const draftIdentity = (
  draft: Pick<RoomDraft, "text" | "anchor">,
  to: ReadonlyArray<PeerRoomTargetInput>,
) => JSON.stringify([draft.text.trim(), to, draft.anchor ?? null]);

/** A retry of the same draft keeps its operation, so the Hub adds nothing twice; an edit is new. */
export function operationFor(
  current: RoomOperation | undefined,
  identity: string,
  mint: () => string,
): RoomOperation {
  return current?.draft === identity ? current : { draft: identity, id: mint() };
}

export type SendOutcome =
  | { readonly kind: "sent" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "unknown" };

/** Only a confirmed post empties the composer; a failed or unknown one keeps every word. */
export const draftAfter = (draft: RoomDraft, outcome: SendOutcome) =>
  outcome.kind === "sent" ? EMPTY_DRAFT : draft;

/** The line under the composer after a send that did not land, or null. */
export function sendNotice(outcome: SendOutcome): string | null {
  switch (outcome.kind) {
    case "sent":
      return null;
    case "failed":
      return `Not sent: ${outcome.reason.replace(/\.$/, "")}. Your message is still here.`;
    case "unknown":
      return "The send could not be confirmed. Your message is still here, and sending it again posts it once.";
  }
}

/** Where `@` is being typed before the caret, or null. An address's `@` is not a mention. */
export function mentionAt(text: string, caret: number) {
  const match = /(?:^|\s)@([\p{L}\p{N}._-]*)$/u.exec(text.slice(0, caret));
  if (match === null) return null;
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, query };
}

export function matchPeople(people: ReadonlyArray<RoomPerson>, query: string) {
  const wanted = query.toLowerCase();
  return people
    .filter(
      (person) =>
        person.label.toLowerCase().includes(wanted) ||
        person.email.toLowerCase().startsWith(wanted),
    )
    .slice(0, 6);
}

/** Puts `@Name ` where `@` was being typed, and says where the caret goes. */
export function insertMention(
  text: string,
  at: { readonly start: number },
  label: string,
  caret: number,
) {
  const mention = `@${label} `;
  return {
    text: `${text.slice(0, at.start)}${mention}${text.slice(caret)}`,
    caret: at.start + mention.length,
  };
}

/** Adds paths to a draft in the form an agent and a reader both take for a path. */
export function withPaths(text: string, paths: ReadonlyArray<string>) {
  const lead = text === "" || /\s$/.test(text) ? "" : " ";
  return `${text}${lead}${paths.map((path) => `\`${path}\``).join(" ")} `;
}

export interface RunActivity {
  readonly kind: "working" | "delivered" | "stopped";
  /** "Claude · Implementation", "Codex · Review". */
  readonly title: string;
  readonly word: string;
  readonly detail: string;
  readonly link: string;
}

const activityTitle = (agent: string | undefined, review: boolean) =>
  `${harnessName(agent) ?? agent ?? "Agent"} · ${review ? "Review" : "Implementation"}`;

/** A reply the agent went on from: that turn is over, whatever its run does now. */
export const turnDone = (agent: string | undefined, review: boolean): RunActivity => ({
  kind: "delivered",
  title: activityTitle(agent, review),
  word: "Done",
  detail: "Replied",
  link: "View changes",
});

/**
 * A run as the conversation shows it, from what its record says and nothing guessed. A run stays
 * open while its session waits for the next message, so `threadWorking`, where a thread of the run
 * is known here, says whether the agent is at work now.
 */
export function runActivity(
  run: Pick<PeerRun, "agent" | "state" | "outcome">,
  input: {
    readonly review: boolean;
    readonly jujutsu: boolean;
    readonly threadWorking?: boolean | undefined;
  },
): RunActivity {
  const title = activityTitle(run.agent, input.review);
  if (run.state === "running" && input.threadWorking === false) {
    return {
      kind: "delivered",
      title,
      word: "Done",
      detail: "Waiting for the next message",
      link: "View changes",
    };
  }
  if (run.state === "running") {
    return {
      kind: "working",
      title,
      word: "Working",
      detail: input.jujutsu ? "Jujutsu workspace" : "Git checkout",
      link: "View live changes",
    };
  }
  if (run.outcome === "done" || run.outcome === "handed-off") {
    return {
      kind: "delivered",
      title,
      word: "Delivered",
      detail: input.review ? "Review ready" : "Ready for review",
      link: "View delivered diff",
    };
  }
  return {
    kind: "stopped",
    title,
    word: run.state === "detached" ? "Idle" : "Ended",
    detail: run.state === "detached" ? "Its session ended. It can continue." : "Nothing delivered",
    link: "View changes",
  };
}

/** A step in a line: what it touched and how much. */
export function stepLine(step: Pick<PeerRoomStep, "files" | "added" | "removed">) {
  const [first = "", ...rest] = step.files;
  const name = first.split("/").at(-1) ?? first;
  return {
    name: rest.length === 0 ? name : `${name} +${rest.length}`,
    counts: [
      ...(step.added > 0 ? [`+${step.added}`] : []),
      ...(step.removed > 0 ? [`−${step.removed}`] : []),
    ].join(" "),
  };
}

/** The last agent to answer in the room: whose work its Jujutsu tab shows until one is picked. */
export function lastAgentReply(messages: ReadonlyArray<Pick<PeerRoomMessage, "seq" | "author">>) {
  return messages.reduce<(typeof messages)[number] | undefined>(
    (last, message) =>
      message.author.run !== undefined && (last === undefined || message.seq > last.seq)
        ? message
        : last,
    undefined,
  );
}

/** What a kept state holds, in words: its change, or its first change and how many more. */
export function snapshotLine(
  snapshot: Pick<
    Extract<PeerRoomSnapshot, { state: "here" }>,
    "changes" | "files" | "added" | "removed"
  >,
) {
  const [first, ...rest] = snapshot.changes;
  return {
    change:
      first === undefined
        ? undefined
        : `${first.slice(0, 8)}${rest.length === 0 ? "" : ` +${rest.length}`}`,
    counts: [
      `${snapshot.files} ${snapshot.files === 1 ? "file" : "files"}`,
      ...(snapshot.added > 0 ? [`+${snapshot.added}`] : []),
      ...(snapshot.removed > 0 ? [`−${snapshot.removed}`] : []),
    ].join(" "),
  };
}

/** Each run's last message: the one that says where the run stands now. */
export function lastOfRuns(messages: ReadonlyArray<Pick<PeerRoomMessage, "seq" | "author">>) {
  const last = new Map<string, number>();
  for (const message of messages) {
    if (message.author.run !== undefined) last.set(message.author.run, message.seq);
  }
  return last;
}

/** Who wrote a message: people and agents differ in type, and an agent also by its name. */
export function authorOf(
  message: Pick<PeerRoomMessage, "author">,
  me: string | null | undefined,
  nameOf: NameOf,
) {
  const mine = me != null && same(message.author.email, me);
  const person = mine ? "You" : nameOf(message.author.email);
  const isAgent = message.author.run !== undefined || message.author.agent !== undefined;
  return isAgent
    ? {
        kind: "agent" as const,
        name: mine ? "Your agent" : `${person}'s agent`,
        harness: message.author.agent,
      }
    : { kind: "person" as const, name: person, harness: undefined };
}

export const deliveriesOf = (message: Pick<PeerRoomMessage, "to">) =>
  message.to.filter((target) => target.kind === "agent");

export const mentionsOf = (message: Pick<PeerRoomMessage, "to">) =>
  message.to.filter((target) => target.kind === "person");

/** The tone of a delivery's line: what waits on a person stands out, an ended one stays quiet. */
export function deliveryTone(delivery: PeerRoomTarget, now: number): SignalTone {
  if (delivery.state === "waiting" || delivery.state === "failed") return "needs";
  if (lostStart(delivery, now)) return "needs";
  if (delivery.state === "answered") return "delivery";
  if (delivery.state === "passed" || delivery.state === "taken" || delivery.state === "heard") {
    return "working";
  }
  return "neutral";
}

const openRun = (run: Pick<PeerRun, "state">) => run.state !== "ended";

/** One of the person's open runs on the task, with what the reach switch says of it. */
export interface ReachRow {
  readonly run: string;
  readonly agent: string;
  readonly team: boolean;
  readonly capacity: PeerRoomCapacity | undefined;
  /** Why Team cannot be chosen; undefined when it can. */
  readonly unavailable: string | undefined;
}

/**
 * A person sees the switch of each of their open runs. Team stays off until this computer says the
 * run is on shared capacity, and a switch that is on can always be turned off.
 */
export function reachRows(
  runs: ReadonlyArray<Pick<PeerRun, "id" | "email" | "state" | "agent">>,
  me: string,
  room: {
    readonly reaches: ReadonlyArray<PeerRoomReach>;
    readonly capacities?: Readonly<Record<string, PeerRoomCapacity>> | undefined;
  } | null,
): ReadonlyArray<ReachRow> {
  return runs
    .filter((run) => same(run.email, me) && openRun(run))
    .map((run) => {
      const capacity = room?.capacities?.[run.id];
      const team = room?.reaches.some((row) => row.run === run.id && row.reach === "team") === true;
      return {
        run: run.id,
        agent: run.agent,
        team,
        capacity,
        unavailable:
          room === null || team || capacity === "shared"
            ? undefined
            : capacity === "personal"
              ? "This run is on your own capacity, so only you can pass messages to it."
              : "This computer cannot tell what carries this run, so Team stays off.",
      };
    });
}
