/**
 * The ownership plugin's client logic, for web and the phone alike: who owns a task, an area and
 * a path, whom a review asks, which owner's calls wait on whom (`ownershipRules.ts`, which
 * `work.ts` and `needsYou.ts` build the board and Needs you on), and the Team view of a project:
 * its people, what needs a person, and its areas and tasks with their owners.
 *
 * The Team view shows facts about work and never people's conversations: other people's chats are
 * counted by status and never named, so nothing here reads a chat's title, a session's label, a
 * request, a prompt or any measure of a person.
 *
 * @module peer/ownership
 */
import type { PeerCoordSession, PeerHubStatus, PeerOverlap } from "@t3tools/contracts";

import { overlapTopic, type NeedsYouItem } from "./needsYou.ts";
import {
  callIsPending,
  ownedPathChanges,
  ownerCallsWaitingOn,
  ownerName,
  pendingCallsOn,
  projectLeads,
  reviewAsks,
  taskOwnerView,
  type OwnedPathChange,
  type ProjectOwnership,
  type ReviewRoute,
  type TaskOwnerView,
} from "./ownershipRules.ts";
import {
  ALL_PROJECTS,
  taskCards,
  type TaskState,
  type WorkProjectNode,
  type WorkTaskCard,
  type WorkThreadNode,
} from "./work.ts";

export * from "./ownershipRules.ts";

/** How long a thing waits on a person before the Team view says so: "over" these. */
export const TEAM_SIGNAL_AFTER_MS = {
  /** An owner's call that waits for its owner. */
  call: 30 * 60_000,
  /** A review that waits for the person it asks. */
  review: 24 * 60 * 60_000,
  /** An agent that waits for its person. */
  agent: 15 * 60_000,
  /** An overlap nobody has touched. */
  overlap: 30 * 60_000,
} as const;

// ---- agents, counted -------------------------------------------------------------------------------

/** One person's chats on a task, or on the project, counted by what they are doing. Never named. */
export interface TeamAgents {
  readonly email: string | undefined;
  readonly name: string;
  readonly mine: boolean;
  readonly working: number;
  /** Waiting for their person: an approval or an answer. */
  readonly waiting: number;
  readonly idle: number;
  /** A colleague's chat nobody reports any more. */
  readonly away: number;
}

/** A person's chats while they are counted. */
interface Counts {
  readonly email: string | undefined;
  readonly name: string;
  readonly mine: boolean;
  working: number;
  waiting: number;
  idle: number;
  away: number;
}

/** The chats that still count: work that was delivered (merged or closed) no longer runs. */
const running = (thread: WorkThreadNode) =>
  thread.delivery !== "merged" && thread.delivery !== "closed";

/**
 * The chats counted by person and status, you first, then by name. A chat is counted, never named:
 * only who it is the person's and what it does is read.
 */
export function countAgents(threads: ReadonlyArray<WorkThreadNode>): ReadonlyArray<TeamAgents> {
  const byPerson = new Map<string, Counts>();
  for (const thread of threads.filter(running)) {
    const key = thread.email ?? `name:${thread.person}`;
    const counts: Counts = byPerson.get(key) ?? {
      email: thread.email,
      name: thread.person,
      mine: thread.mine,
      working: 0,
      waiting: 0,
      idle: 0,
      away: 0,
    };
    if (thread.stale) counts.away += 1;
    else if (thread.status === "working") counts.working += 1;
    else if (thread.status === "blocked") counts.waiting += 1;
    else counts.idle += 1;
    byPerson.set(key, counts);
  }
  return [...byPerson.values()].sort(
    (a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name),
  );
}

/**
 * Agents as a line: "Bob · 2 working", "Your agent · 1 working · Slavo · 1 idle", "No agents yet".
 * `mineAs` names the person looking ("Your agent" on the board; the Team view uses their name).
 */
export function agentsLine(
  agents: ReadonlyArray<TeamAgents>,
  options: { readonly mineAs?: string } = {},
): string {
  if (agents.length === 0) return "No agents yet";
  return agents
    .map((person) => {
      const counts = (
        [
          [person.working, "working"],
          [person.waiting, "waiting"],
          [person.idle, "idle"],
          [person.away, "away"],
        ] as const
      )
        .filter(([count]) => count > 0)
        .map(([count, word]) => `${count} ${word}`)
        .join(", ");
      return `${person.mine && options.mineAs !== undefined ? options.mineAs : person.name} · ${counts}`;
    })
    .join(" · ");
}

// ---- the Team view -----------------------------------------------------------------------------------

/** One member of the project, with what they are doing and what waits on them. */
export interface TeamPerson {
  readonly email: string;
  readonly name: string;
  readonly mine: boolean;
  readonly lead: boolean;
  /** Their chats at work, and those that wait for them, counted from the whole project. */
  readonly working: number;
  readonly waiting: number;
  /** The open and in-review tasks they own (their own or their area's), and the areas they own. */
  readonly owns: number;
  readonly areas: ReadonlyArray<string>;
  /** Decisions that wait on them: owner's calls to them, and reviews that ask them. */
  readonly decisions: number;
}

/** What a task row shows beside its state: a short fact, in the tone of what needs a person. */
export interface TeamBadge {
  readonly text: string;
  readonly tone: "needs" | "plain";
}

/** An owner's call that still waits, on a task. */
export interface TeamCall {
  readonly id: string;
  readonly asker: string;
  /** The person whose agent asked is the person looking. */
  readonly askerMine: boolean;
  readonly owner: string;
  /** The owner is the person looking. */
  readonly ownerMine: boolean;
  readonly paths: ReadonlyArray<string>;
  readonly reason: string;
  readonly since: string;
  readonly expiresAt: string;
}

/** A change an agent made in somebody else's path. */
export interface TeamChange {
  /** Whose agent made it. */
  readonly person: string;
  readonly path: string;
  readonly owner: string;
  readonly ownerMine: boolean;
  readonly decides: boolean;
  readonly waitsForCall: boolean;
  readonly asked: boolean;
}

/** A review of a task, and whom it asks. */
export interface TeamReview {
  readonly route: ReviewRoute;
  /** When the task went to review, as the Hub last said. */
  readonly since: string | undefined;
}

/** An open overlap an agent of the task is in, and the other tasks in it. */
export interface TeamOverlap {
  readonly id: string;
  readonly with: ReadonlyArray<{ readonly id: string; readonly key: string | undefined }>;
}

export interface TeamTask {
  readonly id: string;
  readonly key: string | undefined;
  readonly title: string;
  readonly owner: TaskOwnerView | undefined;
  /** In the words the board uses. */
  readonly state: TaskState;
  readonly agents: ReadonlyArray<TeamAgents>;
  readonly calls: ReadonlyArray<TeamCall>;
  readonly changes: ReadonlyArray<TeamChange>;
  readonly review: TeamReview | undefined;
  readonly overlaps: ReadonlyArray<TeamOverlap>;
  readonly badges: ReadonlyArray<TeamBadge>;
}

export interface TeamArea {
  /** Null for the tasks that sit in no area. */
  readonly name: string | null;
  /** The area's owner, as the owner map says; undefined while nobody on the project is. */
  readonly owner:
    | { readonly email: string; readonly name: string; readonly mine: boolean }
    | undefined;
  /** What the area's owner decides, in a line; undefined where there is nothing to say. */
  readonly rule: string | undefined;
  readonly tasks: ReadonlyArray<TeamTask>;
}

/** What a signal opens: the page that resolves it. */
export type TeamOpen =
  | { readonly kind: "task"; readonly task: string }
  | { readonly kind: "review"; readonly task: string }
  | { readonly kind: "overlap"; readonly overlap: string }
  /** The call, for the person who decides it. */
  | { readonly kind: "owner-call"; readonly call: string }
  | { readonly kind: "set-owner"; readonly task: string }
  /** There is nothing to open: the agent works on no task. */
  | { readonly kind: "none" };

export type TeamSignalKind =
  | "call-waiting"
  | "review-waiting"
  | "agent-waiting"
  | "overlap-open"
  | "landing-stopped"
  | "no-owner";

/** Something that needs a person, with the one thing that opens what resolves it. */
export interface TeamSignal {
  readonly key: string;
  readonly kind: TeamSignalKind;
  readonly what: string;
  readonly detail: string;
  /** When it began, where known, and how long ago that was at `now`. */
  readonly since: string | undefined;
  readonly ageMs: number | undefined;
  readonly action: string;
  readonly open: TeamOpen;
}

export interface TeamView {
  readonly workspace: string;
  readonly project: string;
  readonly name: string;
  /** Ownership is known for the project. Without it there is nothing of the Team view to show. */
  readonly known: boolean;
  /** When the Hub made the view this is built from, to say how old it is. */
  readonly at: string | undefined;
  /** The person may name owners, edit the owner map and decide for an owner who left. */
  readonly canManage: boolean;
  /** This computer's coordination is off: changes in owned paths, agents waiting and overlaps cannot be shown. */
  readonly coordinationOff: boolean;
  readonly people: ReadonlyArray<TeamPerson>;
  readonly signals: ReadonlyArray<TeamSignal>;
  readonly areas: ReadonlyArray<TeamArea>;
  /** What waits on the person in this project: the number on the Team tile. */
  readonly waitingOnMe: number;
}

/**
 * The decisions that wait on `person` (the person looking by default) in a project: the owner's
 * calls to them, and the reviews that ask them. The Team tile shows it without the page's view.
 */
export function decisionsWaitingOn(
  project: Pick<WorkProjectNode, "areas" | "ownership">,
  now: number,
  person: string | null | undefined = project.ownership?.me,
): number {
  const { ownership } = project;
  if (ownership === undefined || person === null || person === undefined) return 0;
  let count = ownerCallsWaitingOn(ownership, person, now).length;
  for (const area of project.areas) {
    for (const task of area.tasks) {
      // A finished task asks nobody: the board puts it under no column of Needs you either.
      if (task.inReview !== true || task.done || task.status === "done") continue;
      const owner = taskOwnerView(ownership, {
        id: task.id,
        ...(area.name === null ? {} : { area: area.name }),
      });
      if (reviewAsks(ownership, owner, person)) count += 1;
    }
  }
  return count;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * A person of the strip, in words: "2 agents at work", "Owns 2 tasks · area Orders",
 * "2 wait on you" ("Nothing waits").
 */
export function teamPersonWords(person: TeamPerson): {
  readonly agents: string;
  readonly owns: string;
  readonly waiting: string;
} {
  const agents = [
    ...(person.working > 0 ? [`${plural(person.working, "agent")} at work`] : []),
    ...(person.waiting > 0
      ? [
          `${plural(person.waiting, "agent")} ${person.waiting === 1 ? "waits" : "wait"} for ${
            person.mine ? "you" : person.name
          }`,
        ]
      : []),
  ];
  const owns = [
    person.owns === 0 ? "Owns no tasks" : `Owns ${plural(person.owns, "task")}`,
    ...(person.areas.length === 0
      ? []
      : [`${person.areas.length === 1 ? "area" : "areas"} ${person.areas.join(", ")}`]),
  ];
  return {
    agents: agents.length === 0 ? "No agents at work" : agents.join(" · "),
    owns: owns.join(" · "),
    waiting:
      person.decisions === 0
        ? "Nothing waits"
        : `${person.decisions} ${person.decisions === 1 ? "waits" : "wait"} on ${
            person.mine ? "you" : person.name
          }`,
  };
}

const days = (ms: number) => Math.floor(ms / 86_400_000);

/** An overlap's last change: the latest of when it was updated, its files changed and its notes. */
function overlapChangedAt(overlap: PeerOverlap): string {
  let latest = overlap.updatedAt;
  for (const at of [
    overlap.filesAt ?? overlap.updatedAt,
    ...overlap.notes.map((note) => note.at),
  ]) {
    if (Date.parse(at) > Date.parse(latest)) latest = at;
  }
  return latest;
}

/** The project's open overlaps and the sessions of the project that are in them. */
interface ProjectCoordination {
  readonly sessions: ReadonlyArray<PeerCoordSession>;
  readonly overlaps: ReadonlyArray<PeerOverlap>;
}

function projectCoordination(
  status: Pick<PeerHubStatus, "coordination">,
  ownership: ProjectOwnership,
): ProjectCoordination {
  if (!status.coordination.enabled) return { sessions: [], overlaps: [] };
  const here = <T extends { readonly workspace: string; readonly project: string }>(row: T) =>
    row.workspace === ownership.workspace && row.project === ownership.project;
  return {
    sessions: status.coordination.sessions.filter(here),
    overlaps: status.coordination.overlaps.filter(
      (overlap) => here(overlap) && overlap.state === "open",
    ),
  };
}

/** "ORD-9", or the task's title where it has no key. */
const taskName = (task: { readonly key?: string | undefined; readonly title: string }) =>
  task.key ?? task.title;

/**
 * Whose a path, a call or an agent is, in a sentence: "Ana's", "Bob's agent". The page is the
 * team's, the same for everyone who reads it, so it names people, the person looking too.
 */
const possessive = (name: string) => `${name}'s`;
const agentOf = (name: string) => `${name}'s agent`;

const SIGNAL_ORDER: Readonly<Record<TeamSignalKind, number>> = {
  "call-waiting": 0,
  "review-waiting": 1,
  "agent-waiting": 2,
  "overlap-open": 3,
  "landing-stopped": 4,
  "no-owner": 5,
};

/**
 * The Team view of a project, from the work tree's node for it and the status: its people with
 * their agents counted, what needs a person (an owner's call waiting over 30 minutes, a review
 * over a day, an agent waiting for its person over 15 minutes, an overlap left open over 30
 * minutes, a change that waits for an owner's call it has not asked for, a task with agents at
 * work and no owner), and its open and in-review tasks by area with their owners, states and
 * agents; a task the board counts as done is left out. `needs` (Needs you's items) tells a waiting
 * chat of the person's from an approval; `now` is the clock the waits are counted by.
 */
export function buildTeamView(input: {
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly needs?: ReadonlyArray<NeedsYouItem>;
  readonly now: number;
}): TeamView {
  const { status, project, now } = input;
  const { ownership } = project;
  const base = {
    workspace: project.workspace,
    project: project.projectId,
    name: project.name,
  };
  if (ownership === undefined) {
    return {
      ...base,
      known: false,
      at: undefined,
      canManage: false,
      coordinationOff: !status.coordination.enabled,
      people: [],
      signals: [],
      areas: [],
      waitingOnMe: 0,
    };
  }
  const { view, me } = ownership;
  const name = (email: string) => ownerName(ownership, email);
  const coordination = projectCoordination(status, ownership);
  const changes = ownedPathChanges(ownership, coordination.sessions, now);
  const cards = taskCards([project], {
    scope: ALL_PROJECTS,
    mine: false,
    query: "",
    needs: input.needs ?? [],
    me: status.email,
  }).filter((card): card is WorkTaskCard => card.kind === "task" && card.state.kind !== "done");
  const cardOf = new Map(cards.map((card) => [card.task.id, card]));
  const hubTask = (id: string) => project.tasks.find((task) => task.id === id);
  const threads = [
    ...project.areas.flatMap((area) => area.tasks.flatMap((task) => task.threads)),
    ...project.unsorted,
  ];
  const sessionOf = new Map(coordination.sessions.map((session) => [session.id, session]));

  // Open overlaps by task: which other tasks an agent of the task is in an overlap with.
  const overlapsOf = (taskId: string): ReadonlyArray<TeamOverlap> =>
    coordination.overlaps.flatMap((overlap): TeamOverlap[] => {
      const tasks = new Set(
        overlap.sessions.flatMap((id) => {
          const task = sessionOf.get(id)?.task;
          return task === undefined ? [] : [task];
        }),
      );
      if (!tasks.has(taskId)) return [];
      const others = [...tasks]
        .filter((id) => id !== taskId)
        .map((id) => ({ id, key: cardOf.get(id)?.task.key ?? hubTask(id)?.key }));
      return others.length === 0 ? [] : [{ id: overlap.id, with: others }];
    });

  const people: ReadonlyArray<TeamPerson> = [...ownership.people]
    .map(([email, personName]): TeamPerson => {
      const own = threads.filter(
        (thread) => running(thread) && !thread.stale && thread.email === email,
      );
      return {
        email,
        name: personName,
        mine: email === me,
        lead: projectLeads(ownership).includes(email),
        working: own.filter((thread) => thread.status === "working").length,
        waiting: own.filter((thread) => thread.status === "blocked").length,
        owns: cards.filter((card) => card.owner?.email === email).length,
        areas: Object.entries(view.map.areas)
          .filter(([, owner]) => owner === email)
          .map(([area]) => area),
        decisions: decisionsWaitingOn(project, now, email),
      };
    })
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));

  const teamTask = (card: WorkTaskCard): TeamTask => {
    const { task, owner } = card;
    const hub = hubTask(task.id);
    const calls: ReadonlyArray<TeamCall> = pendingCallsOn(ownership, task.id, now).map((call) => ({
      id: call.id,
      asker: name(call.email),
      askerMine: call.email === me,
      owner: name(call.owner),
      ownerMine: call.owner === me,
      paths: call.paths,
      reason: call.reason,
      since: call.createdAt,
      expiresAt: call.expiresAt,
    }));
    const own: ReadonlyArray<OwnedPathChange> = changes.filter((change) => change.task === task.id);
    const taskChanges: ReadonlyArray<TeamChange> = own.map((change) => ({
      person: name(change.person),
      path: change.path,
      owner: name(change.owner),
      ownerMine: change.owner === me,
      decides: change.decides,
      waitsForCall: change.waitsForCall,
      asked: change.asked,
    }));
    const review: TeamReview | undefined =
      task.inReview === true && card.review !== undefined
        ? { route: card.review, since: hub?.updatedAt }
        : undefined;
    const overlaps = overlapsOf(task.id);
    return {
      id: task.id,
      key: task.key,
      title: task.title,
      owner,
      state: card.state,
      agents: countAgents(task.threads),
      calls,
      changes: taskChanges,
      review,
      overlaps,
      badges: [
        ...calls.map((call): TeamBadge => ({
          text: `Waiting on ${possessive(call.owner)} call`,
          tone: "needs",
        })),
        ...changeBadges(taskChanges),
        ...(review === undefined ? [] : [reviewBadge(review, now)]),
        ...overlaps.flatMap((overlap) =>
          overlap.with.map((other): TeamBadge => ({
            text: `Overlap with ${other.key ?? other.id}`,
            tone: "plain",
          })),
        ),
      ],
    };
  };

  const areaOwner = (areaName: string | null) => {
    if (areaName === null || !Object.hasOwn(view.map.areas, areaName)) return undefined;
    const email = view.map.areas[areaName];
    return email === undefined || !ownership.people.has(email)
      ? undefined
      : { email, name: name(email), mine: email === me };
  };

  const areas: ReadonlyArray<TeamArea> = project.areas.flatMap((area): TeamArea[] => {
    const tasks = area.tasks.flatMap((task) => {
      const card = cardOf.get(task.id);
      return card === undefined ? [] : [teamTask(card)];
    });
    if (tasks.length === 0) return [];
    const owner = areaOwner(area.name);
    return [{ name: area.name, owner, rule: areaRule(view.map, owner, area.name), tasks }];
  });

  // What needs a person.
  const signals: TeamSignal[] = [];
  const taskTitle = (id: string | undefined) => {
    const card = id === undefined ? undefined : cardOf.get(id);
    const hub = id === undefined ? undefined : hubTask(id);
    return card?.task ?? hub;
  };
  const age = (since: string | number | undefined) => {
    const at =
      since === undefined ? Number.NaN : typeof since === "number" ? since : Date.parse(since);
    return Number.isFinite(at) ? now - at : undefined;
  };
  for (const call of view.calls) {
    const waited = age(call.createdAt);
    if (!callIsPending(call, now) || waited === undefined || waited <= TEAM_SIGNAL_AFTER_MS.call)
      continue;
    const task = taskTitle(call.task);
    const ownerMine = call.owner === me;
    signals.push({
      key: `call:${call.id}`,
      kind: "call-waiting",
      what: `${agentOf(name(call.email))} waits for ${possessive(name(call.owner))} call`,
      detail: [
        ...(task === undefined ? [] : [taskName(task)]),
        call.paths.join(", "),
        `“${call.reason}”`,
      ].join(" · "),
      since: call.createdAt,
      ageMs: waited,
      action: ownerMine ? "Decide" : "Open task",
      open:
        ownerMine || call.task === undefined
          ? { kind: "owner-call", call: call.id }
          : { kind: "task", task: call.task },
    });
  }
  for (const card of cards) {
    const hub = hubTask(card.task.id);
    const waited = age(hub?.updatedAt);
    if (card.review === undefined || waited === undefined || waited <= TEAM_SIGNAL_AFTER_MS.review)
      continue;
    signals.push({
      key: `review:${card.task.id}`,
      kind: "review-waiting",
      what: `${taskName(card.task)} waits for its review${reviewBy(card.review)}`,
      detail: `${card.task.title} · in review since ${days(waited) < 2 ? "yesterday" : `${days(waited)} days ago`}`,
      since: hub?.updatedAt,
      ageMs: waited,
      action: "Open review",
      open: { kind: "review", task: card.task.id },
    });
  }
  for (const session of coordination.sessions) {
    const waited = age(session.activeAt);
    if (
      session.status !== "blocked" ||
      waited === undefined ||
      waited <= TEAM_SIGNAL_AFTER_MS.agent
    )
      continue;
    const person = session.email.toLowerCase();
    const task = taskTitle(session.task);
    signals.push({
      key: `agent:${session.id}`,
      kind: "agent-waiting",
      what: `${agentOf(name(person))} waits for ${name(person)}`,
      detail: task === undefined ? project.name : `${taskName(task)} · ${task.title}`,
      since: session.activeAt,
      ageMs: waited,
      action: session.task === undefined ? "" : "Open task",
      open: session.task === undefined ? { kind: "none" } : { kind: "task", task: session.task },
    });
  }
  for (const overlap of coordination.overlaps) {
    const changedAt = overlapChangedAt(overlap);
    const waited = age(changedAt);
    if (waited === undefined || waited <= TEAM_SIGNAL_AFTER_MS.overlap) continue;
    const parties = overlap.sessions.flatMap((id) => {
      const session = sessionOf.get(id);
      if (session === undefined) return [];
      const task = taskTitle(session.task);
      return [
        `${task === undefined ? "No task" : taskName(task)} (${name(session.email.toLowerCase())})`,
      ];
    });
    signals.push({
      key: `overlap:${overlap.id}`,
      kind: "overlap-open",
      what: `Overlap open on ${overlapTopic(status, overlap)}`,
      detail: parties.join(" and "),
      since: changedAt,
      ageMs: waited,
      action: "Open overlap",
      open: { kind: "overlap", overlap: overlap.id },
    });
  }
  for (const [index, change] of landingStops(changes).entries()) {
    const task = taskTitle(change.task);
    const session = coordination.sessions.find(
      (candidate) =>
        candidate.task === change.task && candidate.email.toLowerCase() === change.person,
    );
    signals.push({
      key: `landing:${change.task ?? "none"}:${change.person}:${change.owner}:${index}`,
      kind: "landing-stopped",
      what: `A push from ${task === undefined ? "a session" : taskName(task)} waits for ${possessive(name(change.owner))} call`,
      detail: `${agentOf(name(change.person))} changed ${change.paths.join(", ")} and has not asked yet`,
      since: session?.activeAt,
      ageMs: age(session?.activeAt),
      action: change.task === undefined ? "" : "Open task",
      open: change.task === undefined ? { kind: "none" } : { kind: "task", task: change.task },
    });
  }
  for (const card of cards) {
    const working = card.task.threads.filter(
      (thread) => running(thread) && !thread.stale && thread.status === "working",
    );
    if (card.owner !== undefined || working.length === 0) continue;
    signals.push({
      key: `no-owner:${card.task.id}`,
      kind: "no-owner",
      what: `${taskName(card.task)} has an agent at work and no owner`,
      detail: `${card.task.title} · ${agentsLine(countAgents(working))}`,
      since: undefined,
      ageMs: undefined,
      action: ownership.canManage ? "Set owner" : "Open task",
      open: ownership.canManage
        ? { kind: "set-owner", task: card.task.id }
        : { kind: "task", task: card.task.id },
    });
  }
  signals.sort(
    (a, b) =>
      SIGNAL_ORDER[a.kind] - SIGNAL_ORDER[b.kind] ||
      (b.ageMs ?? 0) - (a.ageMs ?? 0) ||
      a.key.localeCompare(b.key),
  );

  return {
    ...base,
    known: true,
    at: view.at,
    canManage: ownership.canManage,
    coordinationOff: !status.coordination.enabled,
    people,
    signals,
    areas,
    waitingOnMe: decisionsWaitingOn(project, now),
  };
}

// ---- the words of a task row -------------------------------------------------------------------------

/** "Changed Ana's path src/payments/fees.ts", or, where it cannot land, "Push stopped: needs Ana's call". */
function changeBadges(changes: ReadonlyArray<TeamChange>): ReadonlyArray<TeamBadge> {
  const badges: TeamBadge[] = [];
  const owners = [...new Set(changes.map((change) => change.owner))];
  for (const owner of owners) {
    const theirs = changes.filter((change) => change.owner === owner);
    const stopped = theirs.filter((change) => change.waitsForCall && !change.asked);
    const shown = theirs.filter((change) => !(change.waitsForCall && !change.asked));
    if (stopped.length > 0) {
      badges.push({ text: `Push stopped: needs ${possessive(owner)} call`, tone: "needs" });
    }
    if (shown.length > 0) {
      const first = shown[0]!.path;
      const more = shown.length - 1;
      badges.push({
        text: `Changed ${possessive(owner)} ${more === 0 ? "path" : "paths"} ${first}${
          more === 0 ? "" : ` and ${more} more`
        }`,
        tone: "plain",
      });
    }
  }
  return badges;
}

/** Whom a review asks, as a line says it after "review": " by Ana", " by you", " by the leads". */
function reviewBy(route: ReviewRoute): string {
  if (route.audience === "everyone") return " by anyone";
  if (route.forMe) return " by you";
  const [first] = route.names;
  return ` by ${route.audience === "leads" && route.names.length !== 1 ? "the leads" : (first ?? "its owner")}`;
}

/** "Review by Ana · 1 day": how long it waits once that is a day or more. */
function reviewBadge(review: TeamReview, now: number): TeamBadge {
  const since = review.since === undefined ? Number.NaN : Date.parse(review.since);
  const waited = Number.isFinite(since) ? now - since : 0;
  const long = waited > TEAM_SIGNAL_AFTER_MS.review;
  return {
    text: `Review${reviewBy(review.route)}${long ? ` · ${plural(Math.max(1, days(waited)), "day")}` : ""}`,
    tone: "needs",
  };
}

/** What the changes that wait for a call, and no ask has been made for, come to: one stop per person, owner and task. */
function landingStops(changes: ReadonlyArray<OwnedPathChange>): ReadonlyArray<{
  readonly task: string | undefined;
  readonly person: string;
  readonly owner: string;
  readonly paths: ReadonlyArray<string>;
}> {
  const stops = new Map<
    string,
    { task: string | undefined; person: string; owner: string; paths: string[] }
  >();
  for (const change of changes) {
    if (!change.waitsForCall || change.asked) continue;
    const key = `${change.task ?? ""}\0${change.person}\0${change.owner}`;
    const stop = stops.get(key) ?? {
      task: change.task,
      person: change.person,
      owner: change.owner,
      paths: [],
    };
    stop.paths.push(change.path);
    stops.set(key, stop);
  }
  return [...stops.values()];
}

/**
 * What an area's owner decides, in a line: "Ana decides changes by others in src/payments/**", or,
 * where the owner decides nothing, what they own and that changes by others are only shown.
 */
function areaRule(
  map: { readonly paths: Readonly<Record<string, string>>; readonly decide: ReadonlyArray<string> },
  owner: TeamArea["owner"],
  area: string | null,
): string | undefined {
  if (area === null) return "Tasks without an area fall back to their own owner";
  if (owner === undefined) return undefined;
  const theirs = Object.entries(map.paths)
    .filter(([, email]) => email === owner.email)
    .map(([pattern]) => pattern);
  const decided = theirs.filter((pattern) => map.decide.includes(pattern));
  if (decided.length > 0) return `${owner.name} decides changes by others in ${decided.join(", ")}`;
  return theirs.length === 0
    ? undefined
    : `${owner.name} owns ${theirs.join(", ")}; changes by others are shown, not stopped`;
}
