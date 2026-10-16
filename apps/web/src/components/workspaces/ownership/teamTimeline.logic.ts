/**
 * The Team page's timeline: the project's coordination history as sentences of who decided what.
 * Only what a lead reads for: task moves and handoffs, merged pull requests, owner changes, owner's
 * calls and their decisions, and settled overlaps; claims, reads, notes and the rest of the
 * agents' traffic stay in the history the task and review pages show. Each entry names the person
 * behind it, and an agent's entry names whose agent it was. A call's note comes from the call the
 * project's view carries (the history itself holds no text anyone wrote). Pure, with `now` passed
 * in, so a label never depends on the clock it renders on.
 */
import { coordinationTimeline } from "@t3tools/client-runtime/coordinationTimeline";
import { ownerName, type ProjectOwnership } from "@t3tools/client-runtime/peer/ownership";
import type { PeerCoordEvent, PeerOwnerCall, PeerTask } from "@t3tools/contracts";

import { pathsText } from "./ownerCall.logic";
import { whenLabel } from "./team.logic";

/** How far back the page reads: the Hub keeps a project's history 30 days. */
export const TIMELINE_DAYS = 30;

/** How many events the page asks the Hub for; the most it gives. */
export const TIMELINE_LIMIT = 500;

/** How many entries the timeline shows before "Show older", and how many that adds. */
export const TIMELINE_PAGE = 20;

/** The person behind an entry. */
export interface TimelinePerson {
  readonly email: string;
  readonly name: string;
  readonly mine: boolean;
}

export interface TimelineRow {
  readonly id: string;
  readonly at: string;
  /** "40 min", "1 day". */
  readonly when: string;
  /** Who made it; undefined where nobody did (a call that ran out). */
  readonly person: TimelinePerson | undefined;
  readonly what: string;
  /** The task it is about, as its id. */
  readonly task: string | undefined;
  /** The areas it is about: its task's, or those an owner map change names. */
  readonly areas: ReadonlyArray<string>;
}

/** The kinds of events that say who decided what; every other kind is traffic. */
const KINDS: ReadonlySet<string> = new Set([
  "task-status",
  "handoff",
  "pr-merged",
  "task-owner",
  "owner-map",
  "owner-call",
  "owner-decision",
  "owner-call-closed",
  "resolve",
]);

const value = (event: PeerCoordEvent, prefix: string): string | undefined =>
  event.participants.find((item) => item.startsWith(prefix))?.slice(prefix.length);

/** What the history says of a task owner change: the owner it left (as the history knew it). */
interface OwnerChange {
  /** Who owned the task before this change, as the events in view say; undefined when none shows. */
  readonly previous: string | undefined;
}

/**
 * For each `task-owner` event, who owned the task before it, read from the events before it in
 * the window. A change whose predecessor lies outside the window has no previous owner here.
 */
function ownerChanges(events: ReadonlyArray<PeerCoordEvent>): ReadonlyMap<string, OwnerChange> {
  const last = new Map<string, string | undefined>();
  const changes = new Map<string, OwnerChange>();
  for (const event of events.toReversed()) {
    if (event.kind !== "task-owner" || event.task === undefined) continue;
    changes.set(event.id, { previous: last.get(event.task) });
    const owner = value(event, "owner:");
    last.set(event.task, owner === undefined || owner === "none" ? undefined : owner);
  }
  return changes;
}

/** What the timeline needs to name things. */
interface Names {
  readonly ownership: ProjectOwnership;
  readonly tasks: ReadonlyMap<string, PeerTask>;
  readonly calls: ReadonlyMap<string, PeerOwnerCall>;
  readonly changes: ReadonlyMap<string, OwnerChange>;
}

const personName = (names: Names, email: string | undefined, fallback: string): string =>
  email === undefined || email === "none"
    ? fallback
    : ownerName(names.ownership, email.toLowerCase());

/** "ORD-9", or the task's title where it has no key; undefined for a task the project lost. */
function taskName(names: Names, id: string | undefined): string | undefined {
  const task = id === undefined ? undefined : names.tasks.get(id);
  return task === undefined ? undefined : (task.key ?? task.title);
}

/** The words of one owner map change, after the person's name: "made Cyril owner of the area Menu". */
function mapChange(names: Names, change: string): string | undefined {
  const split = change.lastIndexOf("=");
  if (change.startsWith("area:") && split > 0) {
    const area = change.slice("area:".length, split);
    const owner = change.slice(split + 1);
    return owner === "none"
      ? `took the owner off the area ${area}`
      : `made ${personName(names, owner, owner)} owner of the area ${area}`;
  }
  if (change.startsWith("path:") && split > 0) {
    const pattern = change.slice("path:".length, split);
    const owner = change.slice(split + 1);
    return owner === "none"
      ? `took the owner off ${pattern}`
      : `made ${personName(names, owner, owner)} the owner of ${pattern}`;
  }
  if (change.startsWith("decide:+")) return `made ${change.slice("decide:+".length)} owner-decides`;
  if (change.startsWith("decide:-"))
    return `took owner decides off ${change.slice("decide:-".length)}`;
  return undefined;
}

/** A save of the owner map: its first change in words, and how many more it made. */
function mapSentence(names: Names, event: PeerCoordEvent, actor: string): string {
  const [first, ...more] = event.participants.flatMap((item) => {
    const said = mapChange(names, item);
    return said === undefined ? [] : [said];
  });
  if (first === undefined) return `${actor} changed the owner map`;
  const rest =
    more.length === 0 ? "" : ` and ${more.length} more ${more.length === 1 ? "change" : "changes"}`;
  return `${actor} ${first}${rest}`;
}

/** One event as a sentence; undefined for the kinds a lead does not read the timeline for. */
function sentence(names: Names, event: PeerCoordEvent): string | undefined {
  const agent = event.session !== undefined && event.session !== "";
  const name = personName(names, event.email, "Someone");
  const actor = agent ? `${name}'s agent` : name;
  const task = taskName(names, event.task);
  const ofTask = task ?? "a task";
  const paths = event.paths.length === 0 ? "a path" : pathsText(event.paths);
  switch (event.kind) {
    case "task-status":
    case "handoff": {
      if (event.status === "review") return `${actor} moved ${ofTask} to review`;
      if (event.status === "done") return `${actor} marked ${ofTask} done`;
      if (event.status === "open" && event.fromStatus !== undefined) {
        return `${actor} reopened ${ofTask}`;
      }
      return `${actor} moved ${ofTask}${event.status === undefined ? "" : ` to ${event.status}`}`;
    }
    case "pr-merged": {
      const number = /\/pull\/(\d+)(?:$|[/?#])/.exec(event.link ?? "")?.[1];
      const merged = number === undefined ? "A pull request merged" : `PR #${number} merged`;
      return task === undefined ? merged : `${merged} for ${task}`;
    }
    case "task-owner": {
      const owner = value(event, "owner:");
      const reason = value(event, "reason:");
      const ownerNamed = personName(names, owner, "someone");
      if (owner === undefined || owner === "none") {
        const previous = names.changes.get(event.id)?.previous;
        const gaveBack =
          previous !== undefined &&
          event.email !== undefined &&
          previous.toLowerCase() === event.email.toLowerCase();
        return gaveBack
          ? `${actor} gave ${ofTask} back`
          : `${actor} cleared the owner of ${ofTask}`;
      }
      switch (reason) {
        case "named":
          return `${actor} made ${ownerNamed} the owner of ${ofTask}`;
        case "handover":
          return `${actor} handed ${ofTask} to ${ownerNamed}`;
        case "request":
          // Who sent the request is for the two people it concerns; the history does not say.
          return `${ownerNamed} accepted a request for ${ofTask} and became its owner`;
        case "first-agent":
          return `${ownerNamed} became the owner of ${ofTask} by first agent`;
        default:
          return `${actor} made ${ownerNamed} the owner of ${ofTask}`;
      }
    }
    case "owner-map":
      return mapSentence(names, event, actor);
    case "owner-call": {
      const owner = personName(names, value(event, "owner:"), "an owner");
      const forTask = task === undefined ? "" : ` for ${task}`;
      return `${name}'s agent asked ${owner} to change ${paths}${forTask}`;
    }
    case "owner-decision": {
      const decision = value(event, "decision:");
      const asker = value(event, "asker:");
      const call =
        asker === undefined ? "a call" : `${personName(names, asker, "")}'s agent's call`;
      const owner = personName(names, value(event, "owner:"), "the owner");
      const callId = value(event, "call:");
      const note = callId === undefined ? undefined : names.calls.get(callId)?.note;
      const verb =
        decision === "accepted" ? "accepted" : decision === "declined" ? "declined" : "decided";
      const onBehalf = event.participants.includes("on-behalf") ? ` on ${owner}'s behalf` : "";
      const said = note === undefined || note === "" ? "" : `: “${note}”`;
      return `${name} ${verb} ${call} on ${paths}${onBehalf}${said}`;
    }
    case "owner-call-closed": {
      const owner = personName(names, value(event, "owner:"), "an owner");
      if (event.participants.includes("withdrawn")) {
        return `${name} withdrew a call to ${owner} on ${paths}`;
      }
      const callId = value(event, "call:");
      const asker = callId === undefined ? undefined : names.calls.get(callId)?.email;
      const whose =
        asker === undefined ? "The call" : `${personName(names, asker, "")}'s agent's call`;
      return `${whose} to ${owner} on ${paths} expired`;
    }
    case "resolve":
      return event.paths.length === 0
        ? `${name} settled an overlap`
        : `${name} settled the overlap on ${pathsText(event.paths)}`;
    default:
      return undefined;
  }
}

/** The areas an event is about: its task's, or those an owner map change names. */
function areasOf(names: Names, event: PeerCoordEvent): ReadonlyArray<string> {
  const found = new Set<string>();
  const area = event.task === undefined ? undefined : names.tasks.get(event.task)?.area;
  if (area !== undefined) found.add(area);
  for (const item of event.participants) {
    const split = item.lastIndexOf("=");
    if (item.startsWith("area:") && split > 0) found.add(item.slice("area:".length, split));
  }
  return [...found];
}

/**
 * The timeline: the events of the last 30 days that say who decided what, newest first, one
 * sentence each with the person behind it. `calls` are the calls the project's view carries, which
 * hold the notes of decisions; `tasks` the project's, to name tasks and place them in their areas.
 */
export function timelineRows(input: {
  readonly events: ReadonlyArray<PeerCoordEvent>;
  readonly ownership: ProjectOwnership;
  readonly tasks: ReadonlyArray<PeerTask>;
  readonly now: number;
}): ReadonlyArray<TimelineRow> {
  const { ownership, now } = input;
  const since = now - TIMELINE_DAYS * 86_400_000;
  const timeline = coordinationTimeline(input.events);
  const names: Names = {
    ownership,
    tasks: new Map(input.tasks.map((task) => [task.id, task])),
    calls: new Map(ownership.view.calls.map((call) => [call.id, call])),
    changes: ownerChanges(timeline),
  };
  return timeline.flatMap((event): TimelineRow[] => {
    const at = Date.parse(event.at);
    if (!KINDS.has(event.kind) || !Number.isFinite(at) || at < since) return [];
    const what = sentence(names, event);
    if (what === undefined) return [];
    const email = event.email?.toLowerCase();
    return [
      {
        id: event.id,
        at: event.at,
        when: whenLabel(event.at, now),
        person:
          email === undefined
            ? undefined
            : { email, name: ownerName(ownership, email), mine: email === ownership.me },
        what,
        task: event.task,
        areas: areasOf(names, event),
      },
    ];
  });
}

/** What the timeline is narrowed to; null leaves that out. */
export interface TimelineFilter {
  readonly area: string | null;
  readonly task: string | null;
  readonly person: string | null;
}

export const NO_FILTER: TimelineFilter = { area: null, task: null, person: null };

/** The entries that match every filter that is set: an area's, a task's, the ones a person made. */
export function filterTimeline(
  rows: ReadonlyArray<TimelineRow>,
  filter: TimelineFilter,
): ReadonlyArray<TimelineRow> {
  return rows.filter(
    (row) =>
      (filter.area === null || row.areas.includes(filter.area)) &&
      (filter.task === null || row.task === filter.task) &&
      (filter.person === null || row.person?.email === filter.person),
  );
}

/** What each of the three filters offers: the project's areas, and the tasks and people with entries. */
export interface TimelineChoices {
  readonly areas: ReadonlyArray<string>;
  readonly tasks: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly people: ReadonlyArray<{ readonly email: string; readonly name: string }>;
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function timelineChoices(
  rows: ReadonlyArray<TimelineRow>,
  input: { readonly areas: ReadonlyArray<string>; readonly tasks: ReadonlyArray<PeerTask> },
): TimelineChoices {
  const tasks = new Map(input.tasks.map((task) => [task.id, task]));
  const people = new Map<string, string>();
  const withEntries = new Set<string>();
  for (const row of rows) {
    if (row.task !== undefined && tasks.has(row.task)) withEntries.add(row.task);
    if (row.person !== undefined) people.set(row.person.email, row.person.name);
  }
  return {
    areas: input.areas,
    tasks: [...withEntries]
      .map((id) => {
        const task = tasks.get(id)!;
        return { id, label: task.key ?? task.title };
      })
      .toSorted((a, b) => byText(a.label, b.label)),
    people: [...people]
      .map(([email, name]) => ({ email, name }))
      .toSorted((a, b) => byText(a.name, b.name) || byText(a.email, b.email)),
  };
}

/**
 * For the tasks that have no owner now, a line on how they came to have none when the history in
 * view shows it: "Given back by Eva" where the person who cleared the owner was the owner, "Owner
 * cleared by Slavo" where somebody else cleared it. A task whose owner left or whose clearing lies
 * outside the window has no line.
 */
export function ownerCleared(input: {
  readonly events: ReadonlyArray<PeerCoordEvent>;
  readonly ownership: ProjectOwnership;
  readonly ownerless: ReadonlySet<string>;
}): ReadonlyMap<string, string> {
  const timeline = coordinationTimeline(input.events);
  const changes = ownerChanges(timeline);
  const lines = new Map<string, string>();
  const settled = new Set<string>();
  for (const event of timeline) {
    const { task } = event;
    // Newest first: the first owner event of a task is what happened to its owner last.
    if (event.kind !== "task-owner" || task === undefined || settled.has(task)) continue;
    settled.add(task);
    if (!input.ownerless.has(task) || (value(event, "owner:") ?? "none") !== "none") continue;
    const actor = event.email?.toLowerCase();
    const previous = changes.get(event.id)?.previous?.toLowerCase();
    const by = actor === undefined ? "someone" : ownerName(input.ownership, actor);
    lines.set(
      task,
      previous !== undefined && previous === actor
        ? `Given back by ${by}`
        : `Owner cleared by ${by}`,
    );
  }
  return lines;
}
