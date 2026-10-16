/**
 * The Team section of the workspace on the phone, read-only: the project's people, what needs a
 * person, and its areas with their owners. The view itself is client-runtime's (`buildTeamView`, the
 * one web builds its Team page on); what is here is how a small screen words it.
 *
 * It states facts about work. Chats are counted and never named: the rows below read people, task
 * keys, paths and counts, and nothing that holds a chat's title.
 */
import {
  buildTeamView,
  teamPersonWords,
  type TeamArea,
  type TeamPerson,
  type TeamSignal,
  type TeamTask,
  type TeamView,
} from "@t3tools/client-runtime/peer/ownership";
import { buildWorkTree } from "@t3tools/client-runtime/peer/work";
import type { PeerHubStatus } from "@t3tools/contracts";

import { plural, spanWords } from "./words";

/** The section's own words, as the phone's Team artboard has them. */
export const TEAM_WORDS = {
  title: "Team",
  subtitle: "Facts about the work. Owners change on desktop.",
  signals: "Needs a person",
  nothingWaits: "Nothing waits for a person.",
  areas: "Areas",
  notInAnArea: "Not in an area",
  noOwner: "—",
  coordinationOff:
    "Agent coordination is off on this computer, so changes agents make in owned paths cannot be shown here.",
} as const;

/**
 * The Team view of each of the computer's projects whose ownership is known. A project the status
 * carries no ownership for (the plugin is off, the Hub does not serve it, or no view was read yet)
 * has none, so with the plugin not active nothing of ownership is built, let alone shown.
 */
export function teamProjects(status: PeerHubStatus, now: number): ReadonlyArray<TeamView> {
  return buildWorkTree({ status, localThreads: [], now })
    .filter((project) => project.ownership !== undefined)
    .map((project) => buildTeamView({ status, project, now }))
    .filter((view) => view.known);
}

/**
 * What a project's block is headed by: its name, with its workspace's where the computer is in
 * several and two projects could share a name, as the Work screen does.
 */
export function teamHeading(status: PeerHubStatus, view: TeamView): string {
  const workspace = status.workspaces.find((candidate) => candidate.slug === view.workspace);
  return status.workspaces.length > 1 && workspace !== undefined
    ? `${workspace.name} · ${view.name}`
    : view.name;
}

export interface TeamPersonCard {
  readonly key: string;
  readonly name: string;
  readonly mine: boolean;
  /** "2 at work", "1 waits for Cyril": their agents, counted. */
  readonly agents: string;
  /** "2 wait on Ana", "Nothing waits": the decisions that wait on them. */
  readonly waiting: string;
  /** Something waits on them: the line is in the color of what needs a person. */
  readonly needsThem: boolean;
  /** Everything about the person in one sentence, for a screen reader: it includes what they own. */
  readonly label: string;
}

/** A person's agents on a card of 112 points: the numbers, without the word "agent". */
function agentsWords(person: TeamPerson): string {
  const parts = [
    ...(person.working > 0 ? [`${person.working} at work`] : []),
    ...(person.waiting > 0
      ? [
          `${person.waiting} ${person.waiting === 1 ? "waits" : "wait"} for ${
            person.mine ? "you" : person.name
          }`,
        ]
      : []),
  ];
  return parts.length === 0 ? "No agents at work" : parts.join(" · ");
}

/** The project's members as cards, in the Team view's order: the person looking first. */
export function teamPeople(view: TeamView): ReadonlyArray<TeamPersonCard> {
  return view.people.map((person) => {
    const words = teamPersonWords(person);
    const agents = agentsWords(person);
    return {
      key: person.email,
      name: person.name,
      mine: person.mine,
      agents,
      waiting: words.waiting,
      needsThem: person.decisions > 0,
      label: [person.name, agents, words.owns, words.waiting].join(", "),
    };
  });
}

export interface TeamSignalRow {
  readonly key: string;
  /** "Bob's agent waits for Ana's call". */
  readonly what: string;
  /** "ORD-9 · src/payments/fees.ts · 40 min": which task, which paths, for how long. */
  readonly detail: string;
}

const joined = (parts: ReadonlyArray<string | undefined>) =>
  parts.filter((part): part is string => part !== undefined && part !== "").join(" · ");

/**
 * What a signal adds to its headline on a phone: the task and the paths for a call, the task for an
 * agent that waits, and how long it has waited. The web page has room for more (a call's reason,
 * the task's title); a phone keeps the line short, and the page's own words where the signal has
 * nothing smaller to say.
 */
function signalDetail(signal: TeamSignal, tasks: ReadonlyArray<TeamTask>): string {
  const age = signal.ageMs === undefined ? undefined : spanWords(signal.ageMs);
  const named = (id: string) => {
    const task = tasks.find((candidate) => candidate.id === id);
    return task === undefined ? undefined : (task.key ?? task.title);
  };
  switch (signal.kind) {
    case "call-waiting": {
      // A signal is keyed by what it is about, "call:<id>" for a call (one ask to two owners opens
      // two calls at the same moment, so the time alone would not tell them apart). Where a call
      // is on no task of the page, or the key changes, the page's own words stand.
      const found = tasks
        .flatMap((task) => task.calls.map((call) => ({ task, call })))
        .find(({ call }) => signal.key === `call:${call.id}`);
      return found === undefined
        ? joined([signal.detail, age])
        : joined([found.task.key ?? found.task.title, found.call.paths.join(", "), age]);
    }
    case "review-waiting":
      return joined([age ?? signal.detail]);
    case "agent-waiting": {
      const task = signal.open.kind === "task" ? named(signal.open.task) : undefined;
      return task === undefined ? joined([signal.detail, age]) : joined([task, age]);
    }
    case "overlap-open":
    case "landing-stopped":
    case "no-owner":
      return joined([signal.detail, age]);
  }
}

/** The signals as rows, in the Team view's order, each with the line a phone has room for. */
export function teamSignalRows(view: TeamView): ReadonlyArray<TeamSignalRow> {
  const tasks = view.areas.flatMap((area) => area.tasks);
  return view.signals.map((signal) => ({
    key: signal.key,
    what: signal.what,
    detail: signalDetail(signal, tasks),
  }));
}

export interface TeamAreaRow {
  readonly key: string;
  readonly name: string;
  /** "3 tasks · Ana decides changes by others", "1 task in review", "ORD-14 has no owner". */
  readonly tasks: string;
  /** The area's owner, or a dash while it has none. */
  readonly owner: string;
  readonly label: string;
}

/** What every task of an area shares, where they share it: all in review, or all waiting on one person. */
function sharedStatus(tasks: ReadonlyArray<TeamTask>): string | undefined {
  if (tasks.length > 0 && tasks.every((task) => task.review !== undefined)) return "in review";
  // A review that asks someone else reads as the task waiting on them; that is a review, said above.
  const waiting = new Set(
    tasks.map((task) =>
      task.review === undefined && task.state.kind === "waiting" ? task.state.waitingOn : undefined,
    ),
  );
  const [only] = waiting;
  return waiting.size === 1 && only !== undefined ? `waiting on ${only}` : undefined;
}

/** "Ana decides changes by others" where the area's owner decides what others change; else nothing. */
function decidesWords(area: TeamArea): string | undefined {
  return /^(.+? decides changes by others) in /.exec(area.rule ?? "")?.[1];
}

/**
 * An area's tasks in a line: how many and what they share, which have no owner, and whether its
 * owner decides what others change. One task nobody owns is named, as the lead has to act on it.
 */
function areaTasksLine(area: TeamArea): string {
  const [only] = area.tasks;
  const unowned = area.tasks.filter((task) => task.owner === undefined);
  const shared = sharedStatus(area.tasks);
  if (area.tasks.length === 1 && only !== undefined && unowned.length === 1) {
    return joined([`${only.key ?? only.title} has no owner`, shared, decidesWords(area)]);
  }
  const count = plural(area.tasks.length, "task");
  return joined([
    shared === undefined ? count : `${count} ${shared}`,
    unowned.length === 0 ? undefined : `${unowned.length} without an owner`,
    decidesWords(area),
  ]);
}

/** The areas as rows, in the project's order, each with its owner. */
export function teamAreaRows(view: TeamView): ReadonlyArray<TeamAreaRow> {
  return view.areas.map((area) => {
    const name = area.name ?? TEAM_WORDS.notInAnArea;
    const tasks = areaTasksLine(area);
    const owner = area.owner?.name ?? TEAM_WORDS.noOwner;
    return {
      key: area.name ?? "no-area",
      name,
      tasks,
      owner,
      label: `${name}, ${tasks}, ${area.owner === undefined ? "no owner" : `owner ${owner}`}`,
    };
  });
}
