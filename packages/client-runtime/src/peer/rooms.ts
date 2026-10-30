/**
 * The rooms plugin's client logic, for web and the phone alike: what a delivery says, what a person
 * may do with it, who a message can name, whether an anchor still points at the change, and what
 * waits on a person. The Hub decides every move; these only keep a button from being offered where
 * it would be refused anyway, and keep both clients in the same words.
 *
 * @module peer/rooms
 */
import {
  WS_METHODS,
  type PeerHubStatus,
  type PeerProject,
  type PeerRoomAnchor,
  type PeerRoomMessage,
  type PeerRoomNeed,
  type PeerRoomReach,
  type PeerRoomTarget,
  type PeerRoomTargetInput,
  type PeerRoomsStatus,
  type PeerRun,
  type PeerTask,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/** The plugin's RPC methods as atoms. A client refetches `read` and `diff` when `seq` moves. */
export function createPeerRoomsAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    read: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer.rooms.read",
      tag: WS_METHODS.peerRoomsRead,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    diff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer.rooms.diff",
      tag: WS_METHODS.peerRoomsDiff,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    post: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.rooms.post",
      tag: WS_METHODS.peerRoomsPost,
    }),
    seen: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.rooms.seen",
      tag: WS_METHODS.peerRoomsSeen,
    }),
    pass: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.rooms.pass",
      tag: WS_METHODS.peerRoomsPass,
    }),
    decline: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.rooms.decline",
      tag: WS_METHODS.peerRoomsDecline,
    }),
    withdraw: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.rooms.withdraw",
      tag: WS_METHODS.peerRoomsWithdraw,
    }),
    setReach: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.rooms.set-reach",
      tag: WS_METHODS.peerRoomsSetReach,
    }),
  };
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  a != null && b != null && a.toLowerCase() === b.toLowerCase();

const isDelivery = (target: PeerRoomTarget) => target.kind === "agent";

/** How a client names people: their name in the project, else what it has. */
export type NameOf = (email: string) => string;

/** One person's delivery of a message; a message holds one per owner. */
export const deliveryOf = (message: PeerRoomMessage, email: string | null | undefined) =>
  message.to.find((target) => isDelivery(target) && same(target.email, email));

/** A taken delivery without a run: its start's fate is unknown, and only its owner decides. */
const lostStart = (delivery: PeerRoomTarget) =>
  delivery.state === "taken" && delivery.run === undefined;

/**
 * The plain line under a message for one delivery; null for a person, who has none. Words a newer
 * Hub's state has no entry for fall back to the state itself.
 */
export function deliveryWords(
  delivery: PeerRoomTarget,
  context: { readonly me: string | null | undefined; readonly nameOf: NameOf },
): string | null {
  if (!isDelivery(delivery)) return null;
  const mine = same(delivery.email, context.me);
  const owner = mine ? "you" : context.nameOf(delivery.email);
  const agent = mine ? "your agent" : `${owner}'s agent`;
  const Agent = `${agent[0]?.toUpperCase() ?? ""}${agent.slice(1)}`;
  const reason = delivery.reason?.trim() ?? "";
  switch (delivery.state) {
    case "waiting":
      return `Waiting for ${owner}`;
    case "passed":
      return `Passed on to ${agent}`;
    case "taken":
      return lostStart(delivery) ? `${Agent} may not have started` : `With ${agent}`;
    case "heard":
      return `${Agent} read it and has not answered`;
    case "answered":
      return "Answered";
    case "declined":
      return reason === "" ? "Declined" : `Declined: ${reason}`;
    case "withdrawn":
      return "Withdrawn";
    case "expired":
      return "Expired";
    case "failed":
      return reason === "" ? "Did not start" : `Did not start: ${reason}`;
    default:
      return delivery.state ?? null;
  }
}

export type RoomAction = "pass" | "decline" | "withdraw" | "tryAgain";

/**
 * What a person may do with a delivery: its owner passes on or declines what waits and tries a
 * failed or lost start again (a `pass`); the message's author withdraws while it waits.
 */
export function availableActions(
  message: PeerRoomMessage,
  delivery: PeerRoomTarget,
  me: string | null | undefined,
): ReadonlyArray<RoomAction> {
  if (!isDelivery(delivery)) return [];
  const actions: RoomAction[] = [];
  const owner = same(delivery.email, me);
  if (owner && delivery.state === "waiting") actions.push("pass", "decline");
  if (owner && (delivery.state === "failed" || lostStart(delivery))) actions.push("tryAgain");
  if (delivery.state === "waiting" && same(message.author.email, me)) actions.push("withdraw");
  return actions;
}

/** Whether a message's delivery waits for this person's yes. */
export const waitsOnMe = (message: PeerRoomMessage, me: string | null | undefined) =>
  deliveryOf(message, me)?.state === "waiting";

/** One choice of the composer's To row. */
export interface RoomTargetChoice {
  readonly key: string;
  readonly label: string;
  readonly kind: "team" | "own-agent" | "person" | "agent";
  readonly to: ReadonlyArray<PeerRoomTargetInput>;
  /** Said before sending. */
  readonly note?: string;
  /** Why it cannot be chosen. */
  readonly disabled?: string;
}

const runOpen = (run: Pick<PeerRun, "state">) => run.state !== "ended";

/**
 * The To row: Team first, which is the default; your agent; then each person on the task with
 * their agent. People on the task are those with a run on it, and who created it.
 */
export function targetsFor(
  project: Pick<PeerProject, "members">,
  task: Pick<PeerTask, "id" | "createdBy">,
  runs: ReadonlyArray<Pick<PeerRun, "id" | "task" | "email" | "state">>,
  me: string,
  options: {
    /** This computer has a checkout of the project. */
    readonly hasCheckout?: boolean;
    readonly reaches?: ReadonlyArray<PeerRoomReach>;
    readonly nameOf?: NameOf;
  } = {},
): ReadonlyArray<RoomTargetChoice> {
  const nameOf: NameOf =
    options.nameOf ??
    ((email) => project.members.find((member) => same(member.email, email))?.name ?? email);
  const onTask = runs.filter((run) => run.task === task.id);
  const ownRun = onTask.some((run) => same(run.email, me) && runOpen(run));
  const canAsk = ownRun || options.hasCheckout !== false;
  const people = [...new Set([...onTask.map((run) => run.email), task.createdBy])].filter(
    (email) => !same(email, me),
  );
  const reached = (email: string) =>
    onTask.some(
      (run) =>
        same(run.email, email) &&
        runOpen(run) &&
        options.reaches?.some((row) => row.run === run.id && row.reach === "team") === true,
    );
  return [
    { key: "team", label: "Team", kind: "team", to: [] },
    {
      key: "own-agent",
      label: "Your agent",
      kind: "own-agent",
      to: [{ kind: "agent", email: me }],
      ...(canAsk ? {} : { disabled: "This computer has no checkout of the project." }),
    },
    ...people.flatMap((email): ReadonlyArray<RoomTargetChoice> => {
      const name = nameOf(email);
      return [
        {
          key: `person:${email}`,
          label: name,
          kind: "person",
          to: [{ kind: "person", email }],
        },
        {
          key: `agent:${email}`,
          label: `${name}'s agent`,
          kind: "agent",
          to: [{ kind: "agent", email }],
          note: reached(email)
            ? `${name} lets the team ask this agent on the project's shared capacity.`
            : `${name} decides whether to pass this on.`,
        },
      ];
    }),
  ];
}

/**
 * Where an anchored message can be shown: at its line when it was made on the diff shown,
 * `earlier` when the change moved since, `unknown` when either side names no commit.
 */
export function anchorState(
  anchor: Pick<PeerRoomAnchor, "commit">,
  head: string | undefined,
): "current" | "earlier" | "unknown" {
  if (anchor.commit === undefined || head === undefined) return "unknown";
  return anchor.commit === head ? "current" : "earlier";
}

/** `path:line`, or `path:line-end`, as the phone shows an anchor. */
export const anchorText = (anchor: Pick<PeerRoomAnchor, "path" | "line" | "endLine">) =>
  `${anchor.path}:${anchor.line}${anchor.endLine === undefined || anchor.endLine === anchor.line ? "" : `-${anchor.endLine}`}`;

/** The status a room is read from. */
export type RoomsStatusView = Pick<PeerHubStatus, "rooms">;

export interface RoomPlace {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}

const inPlace = (need: PeerRoomNeed, place: RoomPlace) =>
  need.workspace === place.workspace && need.project === place.project && need.task === place.task;

/** The newest sequence the Hub said of a room; a client refetches when it moves. */
export const roomSeq = (rooms: PeerRoomsStatus | undefined, place: RoomPlace) =>
  rooms?.seqs[place.workspace]?.[place.project]?.[place.task] ?? 0;

/** What the task's badge counts: messages waiting on this person, and mentions of them. */
export const roomBadgeCount = (rooms: PeerRoomsStatus | undefined, place: RoomPlace) =>
  (rooms?.waiting.filter((need) => inPlace(need, place)).length ?? 0) +
  (rooms?.mentions.filter((need) => inPlace(need, place)).length ?? 0);

/** One thing in Needs you. A waiting message has Pass on, Decline and Open room; a mention opens it. */
export interface RoomNeedsYouItem extends RoomPlace {
  readonly key: string;
  readonly kind: "waiting" | "mention";
  readonly seq: number;
  readonly title: string;
  readonly text: string;
  readonly at: string;
  readonly actions: ReadonlyArray<"pass" | "decline" | "open">;
}

/** Needs you's items, newest first, then grouped per task by `needsYouByTask`. */
export function roomNeedsYou(
  rooms: PeerRoomsStatus | undefined,
  nameOf: (need: PeerRoomNeed) => string,
): ReadonlyArray<RoomNeedsYouItem> {
  const item = (need: PeerRoomNeed, kind: RoomNeedsYouItem["kind"]): RoomNeedsYouItem => {
    const who = `${nameOf(need)}${need.agent === true ? "'s agent" : ""}`;
    return {
      key: `room:${kind}:${need.workspace}:${need.project}:${need.task}:${need.seq}`,
      kind,
      workspace: need.workspace,
      project: need.project,
      task: need.task,
      seq: need.seq,
      title: kind === "waiting" ? `${who} asks your agent` : `${who} mentioned you`,
      text: need.text,
      at: need.at,
      actions: kind === "waiting" ? ["pass", "decline", "open"] : ["open"],
    };
  };
  const items = [
    ...(rooms?.waiting ?? []).map((need) => item(need, "waiting")),
    ...(rooms?.mentions ?? []).map((need) => item(need, "mention")),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq);
}

/** Needs you's items per task, so an owner asked ten times on one task sees one group. */
export function needsYouByTask(items: ReadonlyArray<RoomNeedsYouItem>) {
  const groups = new Map<string, RoomNeedsYouItem[]>();
  for (const item of items) {
    const key = `${item.workspace}/${item.project}/${item.task}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups].map(([key, grouped]) => ({ key, items: grouped }));
}
