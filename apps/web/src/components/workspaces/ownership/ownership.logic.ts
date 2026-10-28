/**
 * What the ownership plugin's web UI says and offers, worked out from the status the app already
 * holds: who owns a task and how that reads, who may change it, the people a dialog offers, and
 * what a project's Owners row counts. The rules themselves (who is a task's effective owner, who
 * may change it) are the client runtime's, shared with the phone; this module words them. Pure,
 * with `now` passed in, so a label never depends on the clock it renders on.
 */
import {
  effectiveTaskOwner,
  ownerActions,
  ownerName,
  pendingCallsOn,
  projectOwnership,
  taskOwnerView,
  type OwnerActions,
  type ProjectOwnership,
  type TaskOwnerView,
} from "@t3tools/client-runtime/peer/ownership";
import type {
  PeerHubStatus,
  PeerOwnerCall,
  PeerProjectState,
  PeerWorkspaceState,
} from "@t3tools/contracts";

import { agoLabel, shortWhen } from "../task/taskTime.logic";

/** The task an owner dialog is about, as the Hub knows it. */
export interface OwnedTask {
  readonly id: string;
  readonly key: string | undefined;
  readonly title: string;
  /** The area it sits in; undefined for a task in none. */
  readonly area: string | undefined;
}

/** What the plugin's UI needs to know of one task, for the person looking. */
export interface TaskOwnerFacts {
  readonly workspace: PeerWorkspaceState;
  readonly state: PeerProjectState;
  readonly ownership: ProjectOwnership;
  readonly task: OwnedTask;
  /** Who owns it, its own owner or its area's; undefined for a task nobody owns. */
  readonly owner: TaskOwnerView | undefined;
  /** What the person may do with its owner. */
  readonly actions: TaskOwnerActions;
}

/** Beyond who may change an owner, whether the person may take the task: nobody owns it yet. */
export interface TaskOwnerActions extends OwnerActions {
  readonly take: boolean;
}

/** "ORD-9", or the task's title where it has no key. */
export const taskName = (task: Pick<OwnedTask, "key" | "title">): string => task.key ?? task.title;

/**
 * The facts of one task, or undefined where there are none to show: the project is not in the
 * status, the task is not on it, or the project's ownership is not known (the plugin is off, the
 * Hub does not serve it, or no view was read yet). The UI then draws nothing of ownership.
 */
export function taskOwnerFacts(
  status: Pick<PeerHubStatus, "workspaces" | "ownership" | "email">,
  ids: {
    readonly workspace: string;
    readonly project: string | undefined;
    readonly task: string;
  },
): TaskOwnerFacts | undefined {
  const workspace = status.workspaces.find((candidate) => candidate.slug === ids.workspace);
  const state = workspace?.projects.find((candidate) => candidate.project.id === ids.project);
  if (workspace === undefined || state === undefined) return undefined;
  const ownership = projectOwnership(status, workspace, state.project);
  const hub = state.work.tasks.find((candidate) => candidate.id === ids.task);
  if (ownership === undefined || hub === undefined) return undefined;
  const task: OwnedTask = { id: hub.id, key: hub.key, title: hub.title, area: hub.area };
  const owner = taskOwnerView(ownership, {
    id: task.id,
    ...(task.area === undefined ? {} : { area: task.area }),
  });
  // Any member of the project may take a task nobody owns that is not done; one owned through its
  // area reads as owned, so it is not offered.
  const take =
    owner === undefined &&
    hub.status !== "done" &&
    ownership.me !== null &&
    ownership.people.has(ownership.me);
  const actions = { ...ownerActions(ownership, owner), take };
  return { workspace, state, ownership, task, owner, actions };
}

/**
 * The owner as the task page's badge says it: "Owner: Bob (you)", "Owned through Payments · you",
 * "No owner". (A board card says "Owner Bob" in the same breath; the page has room for the colon.)
 */
export function ownerBadgeLabel(owner: TaskOwnerView | undefined): string {
  if (owner === undefined) return "No owner";
  if (owner.throughArea !== undefined) {
    return `Owned through ${owner.throughArea} · ${owner.mine ? "you" : owner.name}`;
  }
  return `Owner: ${owner.name}${owner.mine ? " (you)" : ""}`;
}

/**
 * Why the task has its owner and since when, for the badge's tooltip: "By request, 2 h ago", "Named
 * by Eva, on 10 Oct", "Through the area Payments". Undefined where there is nothing true to say: no
 * owner, or a reason a newer Hub names that this app has no words for.
 */
export function ownerBadgeWhy(owner: TaskOwnerView | undefined, now: number): string | undefined {
  if (owner === undefined) return undefined;
  if (owner.throughArea !== undefined) return `Through the area ${owner.throughArea}`;
  const reason = (() => {
    switch (owner.reason) {
      case "first-agent":
        return "By first agent";
      case "request":
        return "By request";
      case "named":
        return owner.by === undefined ? "Named by a lead" : `Named by ${owner.by}`;
      case "handover":
        return owner.by === undefined ? "Handed over" : `Handed over by ${owner.by}`;
      case "taken":
        return "Taken";
      case "invited":
        return owner.by === undefined ? "By invitation" : `Invited by ${owner.by}`;
      default:
        return undefined;
    }
  })();
  if (reason === undefined) return undefined;
  const when = owner.since === undefined ? "" : agoLabel(owner.since, now);
  return when === "" ? reason : `${reason}, ${when}`;
}

/** A pending call on a task as its page pill says it, with whom it waits on. */
export interface CallChip {
  readonly call: PeerOwnerCall;
  /** "Waiting on Ana's call · 40 min", "Waits for your call · 40 min". */
  readonly label: string;
}

/**
 * The calls still waiting on the task, one pill each: the person who decides reads "Waits for your
 * call", everyone else, the asker too, "Waiting on Ana's call".
 */
export function taskCallChips(facts: TaskOwnerFacts, now: number): ReadonlyArray<CallChip> {
  const { ownership, task } = facts;
  return pendingCallsOn(ownership, task.id, now).map((call) => {
    const waited = shortWhen(call.createdAt, now);
    const who =
      call.owner === ownership.me
        ? "Waits for your call"
        : `Waiting on ${ownerName(ownership, call.owner)}'s call`;
    return { call, label: waited === "" ? who : `${who} · ${waited}` };
  });
}

export const OWNER_MENU_IDS = {
  take: "owner:take",
  set: "owner:set",
  handOver: "owner:hand-over",
  giveBack: "owner:give-back",
  /** The owner map: every member's, so no `OwnerActions` decides it. */
  seeMap: "owner:see-map",
} as const;
export type OwnerMenuId = (typeof OWNER_MENU_IDS)[keyof typeof OWNER_MENU_IDS];

/**
 * What the owner menu offers the person, in order: Take it for a member while nobody owns the task,
 * Set owner… for the project's leads and the workspace's admins, Hand over… and Give back for the
 * task's own owner. Nothing for anyone else: the Hub would refuse it, so the menu does not offer it.
 */
export function ownerMenuChoices(
  actions: OwnerActions & { readonly take?: boolean },
): ReadonlyArray<{ readonly id: OwnerMenuId; readonly label: string }> {
  return [
    ...(actions.take === true ? [{ id: OWNER_MENU_IDS.take, label: "Take it" }] : []),
    ...(actions.set ? [{ id: OWNER_MENU_IDS.set, label: "Set owner…" }] : []),
    ...(actions.handOver ? [{ id: OWNER_MENU_IDS.handOver, label: "Hand over…" }] : []),
    ...(actions.giveBack ? [{ id: OWNER_MENU_IDS.giveBack, label: "Give back" }] : []),
  ];
}

/** One person a dialog offers as the owner, with a line on what they have to do with the work. */
export interface OwnerCandidate {
  readonly email: string;
  readonly name: string;
  readonly mine: boolean;
  /** "Owns the area Menu", "Owns 2 tasks", "Their agent is at work on ORD-14". */
  readonly note: string | undefined;
}

function listOf(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;

/**
 * The project's members a dialog offers as the new owner, by name; `query` narrows them by name or
 * address. Departed people are not members, so they are not offered (the Hub refuses them too).
 * `leaveOut` takes people out (the person handing the task over). A note says what each has to do
 * with the work, the first that is true: their agent is at work on this task, the areas they own,
 * the open tasks they own.
 */
export function ownerCandidates(
  facts: Pick<TaskOwnerFacts, "ownership" | "state" | "task">,
  status: Pick<PeerHubStatus, "coordination">,
  options: { readonly query?: string; readonly leaveOut?: ReadonlyArray<string> } = {},
): ReadonlyArray<OwnerCandidate> {
  const { ownership, state, task } = facts;
  const query = (options.query ?? "").trim().toLowerCase();
  const left = new Set(options.leaveOut ?? []);
  const owns = new Map<string, number>();
  for (const hub of state.work.tasks) {
    if (hub.status === "done") continue;
    const owner = taskOwnerView(ownership, {
      id: hub.id,
      ...(hub.area === undefined ? {} : { area: hub.area }),
    });
    if (owner !== undefined) owns.set(owner.email, (owns.get(owner.email) ?? 0) + 1);
  }
  const atWork = new Set(
    status.coordination.enabled
      ? status.coordination.sessions
          .filter(
            (session) =>
              session.workspace === ownership.workspace &&
              session.project === ownership.project &&
              session.task === task.id &&
              session.status === "working",
          )
          .map((session) => session.email.toLowerCase())
      : [],
  );
  return [...ownership.people.keys()]
    .filter((email) => !left.has(email))
    .map((email): OwnerCandidate => {
      const mine = email === ownership.me;
      const areas = Object.entries(ownership.view.map.areas)
        .filter(([, owner]) => owner === email)
        .map(([area]) => area);
      const tasks = owns.get(email) ?? 0;
      return {
        email,
        name: ownerName(ownership, email),
        mine,
        note: atWork.has(email)
          ? `${mine ? "Your" : "Their"} agent is at work on ${taskName(task)}`
          : areas.length > 0
            ? `Owns the ${areas.length === 1 ? "area" : "areas"} ${listOf(areas)}`
            : tasks > 0
              ? `Owns ${plural(tasks, "task")}`
              : undefined,
      };
    })
    .filter(
      (candidate) =>
        query === "" ||
        candidate.name.toLowerCase().includes(query) ||
        candidate.email.includes(query),
    )
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

/** What the person is told a task's owner is now, under its title in a dialog. */
export function currentOwnerWords(owner: TaskOwnerView | undefined): string {
  if (owner === undefined) return "no owner";
  const who = owner.mine ? "you" : owner.name;
  return owner.throughArea === undefined
    ? `owned by ${who}`
    : `owned through ${owner.throughArea} by ${who}`;
}

/** The words under the list in Set owner, for the pick: who sees it where, and what is recorded. */
export function setOwnerExplanation(pick: OwnerCandidate | null, task: OwnedTask): string {
  const recorded = "The change is recorded in the project's history with your name.";
  if (pick === null) {
    return `${taskName(task)} will have no owner and falls back to its area's owner, if any. ${recorded}`;
  }
  return `${pick.mine ? "You" : pick.name} will see ${taskName(task)} under Mine and can give it back. ${recorded}`;
}

/** What Set owner's button says for the pick. */
export function setOwnerConfirm(pick: OwnerCandidate | null): string {
  if (pick === null) return "Clear the owner";
  return pick.mine ? "Make yourself the owner" : `Make ${pick.name} the owner`;
}

/**
 * What Hand over tells the person about what happens next: their agents on the task hear once who
 * owns it now (and keep working, where one is at work); a call of theirs to the new owner stays
 * open; the new owner can give the task back.
 */
export function handOverNotes(input: {
  readonly facts: Pick<TaskOwnerFacts, "ownership" | "task">;
  readonly status: Pick<PeerHubStatus, "coordination">;
  readonly pick: OwnerCandidate;
  readonly now: number;
}): ReadonlyArray<string> {
  const { ownership, task } = input.facts;
  const { me } = ownership;
  const mine =
    me === null || !input.status.coordination.enabled
      ? []
      : input.status.coordination.sessions.filter(
          (session) =>
            session.workspace === ownership.workspace &&
            session.project === ownership.project &&
            session.task === task.id &&
            session.email.toLowerCase() === me,
        );
  const pending = pendingCallsOn(ownership, task.id, input.now).some(
    (call) => call.email === me && call.owner === input.pick.email,
  );
  const hearOnce = `once that ${input.pick.name} owns the task now.`;
  return [
    ...(mine.some((session) => session.status === "working")
      ? [`Your agents on ${taskName(task)} keep working; they hear ${hearOnce}`]
      : mine.length > 0
        ? [`Your agents on ${taskName(task)} hear ${hearOnce}`]
        : []),
    pending
      ? `Your pending call to ${input.pick.name} stays open. ${input.pick.name} can give the task back.`
      : `${input.pick.name} can give the task back.`,
  ];
}

/** The line under a person's name in Hand over: their address, then what they have to do with it. */
export function handOverCandidateLine(candidate: OwnerCandidate): string {
  const note = candidate.note;
  return note === undefined
    ? candidate.email
    : `${candidate.email} · ${note.charAt(0).toLowerCase()}${note.slice(1)}`;
}

/**
 * What a project's Owners row counts: its areas that have an owner, and its open tasks that have
 * none. "3 areas with an owner · 1 task without one". Undefined where there is nothing to count, or
 * where ownership is not known for the project.
 */
export function ownersSummary(
  ownership: ProjectOwnership | undefined,
  state: Pick<PeerProjectState, "work">,
): string | undefined {
  if (ownership === undefined) return undefined;
  const { map } = ownership.view;
  const areas = state.work.areas;
  const withOwner = areas.filter(
    (area) => effectiveTaskOwner({ area }, undefined, map, ownership.people) !== undefined,
  ).length;
  const open = state.work.tasks.filter((task) => task.status !== "done");
  const without = open.filter(
    (task) =>
      taskOwnerView(ownership, {
        id: task.id,
        ...(task.area === undefined ? {} : { area: task.area }),
      }) === undefined,
  ).length;
  const parts = [
    ...(areas.length === 0
      ? []
      : [withOwner === 0 ? "No area has an owner" : `${plural(withOwner, "area")} with an owner`]),
    ...(open.length === 0
      ? []
      : [
          without === 0 ? "Every open task has an owner" : `${plural(without, "task")} without one`,
        ]),
  ];
  return parts.length === 0 ? undefined : parts.join(" · ");
}
