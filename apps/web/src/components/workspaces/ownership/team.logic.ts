/**
 * What the Team page says, worked out from the Team view (the client runtime's `buildTeamView`,
 * shared with the phone) and the status the app already holds: which of its pages to draw, how
 * old the Hub's view is, how a person's role, a signal's wait and the owner map read. The rules
 * (who owns what, what needs a person, how many agents are at work) are the client runtime's; this
 * module only words them. Pure, with `now` passed in, so a label never depends on the clock it
 * renders on.
 */
import {
  ownerName,
  type ProjectOwnership,
  type TeamBadge,
  type TeamCall,
  type TeamPerson,
  type TeamSignal,
  type TeamTask,
  type TeamView,
} from "@t3tools/client-runtime/peer/ownership";
import type { PeerHubStatus, PeerOwnerCall } from "@t3tools/contracts";

import { agoLabel } from "../task/taskTime.logic";
import type { SignalTone } from "../signals";
import type { WorkProjectNode } from "../workTree.logic";
import { callDetails } from "./ownerCall.logic";

/** What the Team page of a project is, before it draws anything. */
export type TeamPageState =
  /** The status, or the first sync of the workspace, has not arrived yet. */
  | { readonly kind: "loading" }
  /** The person is not on the project, or there is no such project: the Hub says the same for both. */
  | { readonly kind: "unavailable" }
  /** The project is theirs, but no view of its ownership was read yet. */
  | { readonly kind: "unknown"; readonly project: WorkProjectNode }
  | {
      readonly kind: "ready";
      readonly project: WorkProjectNode;
      readonly ownership: ProjectOwnership;
    };

/**
 * Which page to draw for the project the address names. A project the status does not list for the
 * person reads as unavailable once Peer has synced with the Hub (before that the workspace may
 * simply not have arrived), and nothing of it is drawn: the words are those of a project that does
 * not exist, so the page gives nothing away.
 */
export function teamPageState(input: {
  readonly status: Pick<PeerHubStatus, "workspaces" | "lastSyncAt" | "signedIn"> | null;
  readonly tree: ReadonlyArray<WorkProjectNode>;
  readonly workspace: string;
  readonly project: string;
}): TeamPageState {
  const { status } = input;
  if (status === null) return { kind: "loading" };
  const project = input.tree.find(
    (candidate) => candidate.workspace === input.workspace && candidate.projectId === input.project,
  );
  if (project !== undefined) {
    const { ownership } = project;
    return ownership === undefined
      ? { kind: "unknown", project }
      : { kind: "ready", project, ownership };
  }
  const workspace = status.workspaces.find((candidate) => candidate.slug === input.workspace);
  const synced = workspace === undefined ? status.lastSyncAt : workspace.lastSyncAt;
  return status.signedIn && synced === null ? { kind: "loading" } : { kind: "unavailable" };
}

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;

/** "8 s", "3 min", "2 h", "1 day": how long ago `at` was; undefined for a date nobody can read. */
export function viewAgeLabel(at: string | undefined, now: number): string | undefined {
  const time = at === undefined ? Number.NaN : Date.parse(at);
  if (!Number.isFinite(time)) return undefined;
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE_MS) return `${Math.floor(elapsed / SECOND_MS)} s`;
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h`;
  return plural(Math.floor(elapsed / DAY_MS), "day");
}

/**
 * The state at the end of the page's header: whether this computer's agents coordinate, and how
 * old the Hub's view of the project is ("Coordination on this computer · view 8 s old"). While
 * coordination is on it is a state worth a hue; while it is off it only says so.
 */
export function teamHeaderState(
  view: Pick<TeamView, "at" | "coordinationOff">,
  now: number,
): { readonly label: string; readonly tone: SignalTone } {
  const age = viewAgeLabel(view.at, now);
  const state = view.coordinationOff
    ? "Coordination off on this computer"
    : "Coordination on this computer";
  return {
    label: age === undefined ? state : `${state} · view ${age} old`,
    tone: view.coordinationOff ? "neutral" : "delivery",
  };
}

/** A person's role on the project as the strip says it: "You · lead", "Lead", "Member". */
export function personRole(person: Pick<TeamPerson, "mine" | "lead">): string {
  const role = person.lead ? "lead" : "member";
  return person.mine ? `You · ${role}` : `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

/** "5 on the project". */
export const peopleCount = (people: ReadonlyArray<unknown>): string =>
  `${people.length} on the project`;

/**
 * How long a signal has waited, in a column: "now", "6 min", "2 h", "1 day". A signal with no
 * beginning (an agent at work on a task that has no owner) holds now.
 */
export function signalAge(ageMs: number | undefined): string {
  if (ageMs === undefined || ageMs < MINUTE_MS) return "now";
  if (ageMs < HOUR_MS) return `${Math.floor(ageMs / MINUTE_MS)} min`;
  if (ageMs < DAY_MS) return `${Math.floor(ageMs / HOUR_MS)} h`;
  return plural(Math.floor(ageMs / DAY_MS), "day");
}

/**
 * A task's badges, with the ones for the calls it waits on told apart so each can open the call it
 * stands for. The Team view lists a task's pending calls first, one badge each; a list that does
 * not start that way is taken as having none to tell apart.
 */
export function splitCallBadges(task: Pick<TeamTask, "calls" | "badges">): {
  readonly calls: ReadonlyArray<{ readonly call: TeamCall; readonly badge: TeamBadge }>;
  readonly rest: ReadonlyArray<TeamBadge>;
} {
  const leading = task.badges.slice(0, task.calls.length);
  if (
    leading.length !== task.calls.length ||
    !leading.every((b) => b.text.startsWith("Waiting on"))
  ) {
    return { calls: [], rest: task.badges };
  }
  return {
    calls: task.calls.map((call, index) => ({ call, badge: leading[index]! })),
    rest: task.badges.slice(task.calls.length),
  };
}

/**
 * What the project's history would show that the page has, as a short string that changes when a
 * task moves, an owner or a call changes, the owner map is saved or an overlap opens or closes, and
 * not when an agent only reports: the page reads the history again when it changes. The Hub's
 * `at` on the view is no part of it, since it moves with every report.
 */
export function historyRevision(
  project: Pick<WorkProjectNode, "tasks" | "ownership">,
  status: Pick<PeerHubStatus, "coordination">,
): string {
  const view = project.ownership?.view;
  const overlaps = status.coordination.enabled
    ? status.coordination.overlaps
        .filter((overlap) => overlap.state === "open")
        .map((overlap) => overlap.id)
    : [];
  return [
    view?.map.version ?? "-",
    (view?.calls ?? []).map((call) => `${call.id}=${call.state}`).join(","),
    Object.values(view?.tasks ?? {})
      .map((row) => `${row.task}=${row.owner}`)
      .join(","),
    project.tasks.map((task) => `${task.id}=${task.status}`).join(","),
    overlaps.join(","),
  ].join("|");
}

/** What a signal's action opens: the page that resolves it. */
export type SignalTarget =
  | { readonly kind: "task"; readonly task: string }
  | { readonly kind: "review"; readonly task: string }
  | { readonly kind: "overlap"; readonly overlap: string }
  | { readonly kind: "set-owner"; readonly task: string }
  /** The person may decide the call: Accept or Decline, each with a note, in the dialog. */
  | {
      readonly kind: "decide";
      readonly call: PeerOwnerCall;
      readonly accept: string;
      readonly decline: string;
      /** They decide for an owner, as a lead or an admin: the record says so. */
      readonly onBehalf: boolean;
    };

/** The one thing a signal offers, and what it opens. */
export interface SignalAction {
  readonly label: string;
  readonly target: SignalTarget;
}

/**
 * What a signal's button does for the person looking. A call waiting on its owner opens its
 * decision for the owner (and for a lead or an admin, who may decide it for them), the task page
 * for everyone else; a signal that points at no page (an agent that works on no task) offers
 * nothing, and nor does a call the person may not decide and that has no task to open.
 */
export function signalAction(
  signal: Pick<TeamSignal, "open" | "action">,
  input: { readonly ownership: ProjectOwnership; readonly now: number },
): SignalAction | undefined {
  const { open } = signal;
  if (open.kind === "none" || signal.action === "") return undefined;
  if (open.kind !== "owner-call") return { label: signal.action, target: open };
  const call = input.ownership.view.calls.find((candidate) => candidate.id === open.call);
  if (call === undefined) return undefined;
  const { decisions, actions } = callDetails(input.ownership, call, input.now);
  if (decisions === undefined) return undefined;
  return {
    label: "Decide",
    target: {
      kind: "decide",
      call,
      accept: decisions.accept,
      decline: decisions.decline,
      onBehalf: actions.decide === "on-behalf",
    },
  };
}

/** How long ago something happened, for the timeline's column: "now", "40 min", "2 h", "2 days". */
export const whenLabel = (at: string, now: number): string => {
  const time = Date.parse(at);
  return Number.isFinite(time) ? signalAge(Math.max(0, now - time)) : "";
};

/** One area of the project and who owns it; undefined where nobody on the project does. */
export interface MapAreaLine {
  readonly name: string;
  readonly owner: string | undefined;
  /** The project does not list this area any more: its row in the map was left behind by a rename. */
  readonly stale: boolean;
}

/** One pattern of the map: who owns what it matches, and whether they decide changes by others. */
export interface MapPathLine {
  readonly pattern: string;
  /** Undefined where nobody on the project does: no row names one, or the person left. */
  readonly owner: string | undefined;
  readonly decides: boolean;
}

/** The project's owner map as people read it, with the line that says who changed it last. */
export interface OwnerMapSummary {
  readonly version: number;
  /** "v7 · Slavo changed it 1 h ago"; "Not saved yet" before the first save. */
  readonly card: string;
  /** "Version 7 · last changed by Slavo 1 h ago"; "Version 0 · not saved yet". */
  readonly page: string;
  readonly areas: ReadonlyArray<MapAreaLine>;
  readonly paths: ReadonlyArray<MapPathLine>;
}

const compareCodePoints = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The owner map of a project: each of its areas in the project's order (then those the map still
 * holds and the project no longer lists), and its patterns in alphabetical order with the ones
 * where the owner decides. A person who left owns nothing, so their rows read as unowned: a lead
 * names someone else.
 */
export function ownerMapSummary(input: {
  readonly ownership: ProjectOwnership;
  /** The project's areas in order, as the Hub lists them. */
  readonly areas: ReadonlyArray<string>;
  readonly now: number;
}): OwnerMapSummary {
  const { ownership, now } = input;
  const { map } = ownership.view;
  const present = (email: string | undefined) =>
    email !== undefined && ownership.people.has(email) ? ownerName(ownership, email) : undefined;
  const known = new Set(input.areas);
  const left = Object.keys(map.areas)
    .filter((area) => !known.has(area))
    .toSorted(compareCodePoints);
  const patterns = [...new Set([...Object.keys(map.paths), ...map.decide])].toSorted(
    compareCodePoints,
  );
  // Who saved it is a fact whether or not they are still on the project.
  const by =
    map.updatedBy === undefined ? undefined : ownerName(ownership, map.updatedBy.toLowerCase());
  const ago = map.updatedAt === undefined ? "" : agoLabel(map.updatedAt, now);
  const changed = by === undefined || ago === "" ? undefined : { by, ago };
  return {
    version: map.version,
    card:
      map.version === 0
        ? "Not saved yet"
        : `v${map.version}${changed === undefined ? "" : ` · ${changed.by} changed it ${changed.ago}`}`,
    page:
      map.version === 0
        ? "Version 0 · not saved yet"
        : `Version ${map.version}${changed === undefined ? "" : ` · last changed by ${changed.by} ${changed.ago}`}`,
    areas: [
      ...input.areas.map((name) => ({
        name,
        owner: present(Object.hasOwn(map.areas, name) ? map.areas[name] : undefined),
        stale: false,
      })),
      ...left.map((name) => ({ name, owner: present(map.areas[name]), stale: true })),
    ],
    paths: patterns.map((pattern) => ({
      pattern,
      owner: present(Object.hasOwn(map.paths, pattern) ? map.paths[pattern] : undefined),
      decides: map.decide.includes(pattern),
    })),
  };
}
