/**
 * Ownership as the apps read it: who owns a task, an area and a path, whose decision an owner's
 * call waits for, and whom a review in the board asks. The Hub decides all of this too
 * (`server/src/features/ownership`); what is here is the same rules, for showing and routing
 * what the Hub already answered. Both sides run the cases of `ownership.fixtures.json`, the
 * Hub's own file kept byte for byte: change a rule, change that file, and change both repositories.
 *
 * Pure, and free of what Hermes lacks, so web and mobile share it. `work.ts` and `needsYou.ts`
 * import this module, so it imports neither at runtime; `ownership.ts` adds the Team view on top
 * of both.
 *
 * @module peer/ownershipRules
 */
import type {
  PeerCoordSession,
  PeerHubStatus,
  PeerOwnerCall,
  PeerOwnerMap,
  PeerOwnershipProject,
  PeerProject,
  PeerWorkspaceState,
} from "@t3tools/contracts";

import { comparePatterns, matchesPattern } from "../peerSettings.ts";

/** The people on a project now, by address: a set of them, or a map from address to name. */
export interface Members {
  readonly has: (email: string) => boolean;
}

/** A task's effective owner, and whether it comes through the task's area. */
export interface EffectiveOwner {
  readonly owner: string;
  readonly throughArea: boolean;
}

/**
 * A task's effective owner: the owner of its own row while they are on the project, else the owner
 * its area has in the map while they are; nobody when neither is. Areas match as written. An owner
 * who left owns nothing, so a task they owned falls back as if it had no owner.
 */
export function effectiveTaskOwner(
  task: { readonly area?: string | undefined },
  row: { readonly owner: string } | null | undefined,
  map: Pick<PeerOwnerMap, "areas">,
  members: Members,
): EffectiveOwner | undefined {
  if (row !== null && row !== undefined && members.has(row.owner)) {
    return { owner: row.owner, throughArea: false };
  }
  if (task.area === undefined || !Object.hasOwn(map.areas, task.area)) return undefined;
  const owner = map.areas[task.area];
  return owner !== undefined && members.has(owner) ? { owner, throughArea: true } : undefined;
}

/** The pattern of an owner map that decides a path, and who owns it. */
interface Matched {
  readonly pattern: string;
  readonly owner: string;
}

/**
 * The most specific pattern of the map's paths that matches `path`, by the order of coordination
 * path patterns (more literal characters, then fewer `**`, then fewer `*`, then the one that
 * sorts first); undefined when none matches.
 */
function matchedPattern(map: Pick<PeerOwnerMap, "paths">, path: string): Matched | undefined {
  let best: Matched | undefined;
  for (const [pattern, owner] of Object.entries(map.paths)) {
    if (!matchesPattern(pattern, path)) continue;
    if (best === undefined || comparePatterns(pattern, best.pattern) < 0) best = { pattern, owner };
  }
  return best;
}

/** The owner of a path, the pattern that makes them so, and whether they have left the project. */
export interface PathOwner extends Matched {
  /**
   * The owner is not on the project any more. The pattern still decides the path (it does not
   * pass to a wider one); the project's leads answer for it.
   */
  readonly left: boolean;
}

/** The owner of the most specific pattern that matches `path`; undefined where none does. */
export function pathOwner(
  map: Pick<PeerOwnerMap, "paths">,
  path: string,
  members: Members,
): PathOwner | undefined {
  const matched = matchedPattern(map, path);
  return matched === undefined ? undefined : { ...matched, left: !members.has(matched.owner) };
}

/** Whether `path` matches a pattern where the owner decides changes by others. */
export function ownerDecides(map: Pick<PeerOwnerMap, "decide">, path: string): boolean {
  return map.decide.some((glob) => matchesPattern(glob, path));
}

/**
 * Whom `person`'s agent has to ask before it changes `path`: the path's owner, when the path is
 * one where the owner decides and the owner is somebody else. A path nobody owns, or where the
 * owner does not decide, needs nobody's call; an owner who left is still the one asked, and the
 * leads decide for them.
 */
export function ownerToAsk(
  map: Pick<PeerOwnerMap, "paths" | "decide">,
  person: string,
  path: string,
): string | undefined {
  const owner = matchedPattern(map, path)?.owner;
  return owner !== undefined && owner !== person && ownerDecides(map, path) ? owner : undefined;
}

/** What a call names of the work it is about: the session, its computer, its person and its task. */
export type CallSession = Pick<PeerCoordSession, "id" | "email" | "environment" | "task">;

/** The parts of a call that say what it covers. */
export type CoveringCall = Pick<
  PeerOwnerCall,
  "state" | "task" | "session" | "environment" | "email" | "paths"
>;

/** Whether `call` is about the work of `session`: its task, or, with none, that very session. */
function callAbout(call: CoveringCall, session: CallSession): boolean {
  return call.task === undefined
    ? call.session === session.id &&
        call.environment === session.environment &&
        call.email === session.email
    : session.task === call.task;
}

/** Whether `call` names `path`, or a directory (a path ending in `/`) that holds it. */
function callNames(call: Pick<PeerOwnerCall, "paths">, path: string): boolean {
  return call.paths.some(
    (named) => named === path || (named.endsWith("/") && path.startsWith(named)),
  );
}

/**
 * Whether an accepted call covers `path` for `session`: it is about the session's task (or, with
 * no task, that very session), and it names the path or a directory that holds it.
 */
export function callCovers(call: CoveringCall, session: CallSession, path: string): boolean {
  return call.state === "accepted" && callAbout(call, session) && callNames(call, path);
}

/** A project's ownership as one person looks at it. */
export interface ProjectOwnership {
  readonly workspace: string;
  readonly project: string;
  /** The Hub's last view of the project, as the status carries it. */
  readonly view: PeerOwnershipProject;
  /** The people on the project now, by address in lower case, with their names. */
  readonly people: ReadonlyMap<string, string>;
  /** The person looking, in lower case; null while signed out. */
  readonly me: string | null;
  /** They lead the project or administer the workspace: they name owners, edit the map, decide for an owner who left. */
  readonly canManage: boolean;
}

/**
 * The ownership of one of the person's projects, or undefined while the status has none: the
 * plugin is off or the Hub does not serve it, or no view of this project was read yet. Clients then
 * behave as they did before ownership: no owners, reviews in every member's Needs you.
 */
export function projectOwnership(
  status: Pick<PeerHubStatus, "ownership" | "email">,
  workspace: Pick<PeerWorkspaceState, "slug" | "role">,
  project: Pick<PeerProject, "id" | "role" | "members">,
): ProjectOwnership | undefined {
  const view = status.ownership?.projects.find(
    (entry) => entry.workspace === workspace.slug && entry.project === project.id,
  );
  if (view === undefined) return undefined;
  return {
    workspace: workspace.slug,
    project: project.id,
    view,
    people: new Map(project.members.map(({ email, name }) => [email.toLowerCase(), name])),
    me: status.email?.toLowerCase() ?? null,
    canManage: project.role === "lead" || workspace.role !== "member",
  };
}

/** A person's name as the project knows it; for someone it does not, the start of their address. */
export function ownerName(ownership: Pick<ProjectOwnership, "people">, email: string): string {
  const known = ownership.people.get(email);
  if (known !== undefined && known !== "") return known;
  const local = email.split("@")[0]?.split(/[._-]/)[0] ?? email;
  return local === "" ? email : `${local[0]?.toUpperCase() ?? ""}${local.slice(1)}`;
}

/** The project's leads who are on it now, in lower case. */
export function projectLeads(ownership: ProjectOwnership): ReadonlyArray<string> {
  return ownership.view.leads
    .map((lead) => lead.toLowerCase())
    .filter((lead) => ownership.people.has(lead));
}

/** Who owns a task and why, for the person looking. */
export interface TaskOwnerView {
  readonly email: string;
  readonly name: string;
  readonly mine: boolean;
  /** The area the owner comes through, for a task with no owner of its own. */
  readonly throughArea: string | undefined;
  /** Why the task has its owner: `first-agent`, `request`, `named` or `handover`. Not through an area. */
  readonly reason: string | undefined;
  /** Since when. Not through an area. */
  readonly since: string | undefined;
  /** Who made the change, by name; undefined where the Hub did, and through an area. */
  readonly by: string | undefined;
}

/** The effective owner of a task, as the person looking sees it; undefined for a task nobody owns. */
export function taskOwnerView(
  ownership: ProjectOwnership | undefined,
  task: { readonly id: string; readonly area?: string | undefined },
): TaskOwnerView | undefined {
  if (ownership === undefined) return undefined;
  const { view, people, me } = ownership;
  const row = Object.hasOwn(view.tasks, task.id) ? view.tasks[task.id] : undefined;
  const effective = effectiveTaskOwner(task, row, view.map, people);
  if (effective === undefined) return undefined;
  const own = effective.throughArea ? undefined : row;
  return {
    email: effective.owner,
    name: ownerName(ownership, effective.owner),
    mine: effective.owner === me,
    throughArea: effective.throughArea ? task.area : undefined,
    reason: own?.reason,
    since: own?.since,
    by: own?.by === undefined ? undefined : ownerName(ownership, own.by.toLowerCase()),
  };
}

/** What a card or a row says of a task's owner: "Owner Bob", "Owner Ana (you)", "Owned through Payments · you", "No owner". */
export function ownerLine(owner: TaskOwnerView | undefined): string {
  if (owner === undefined) return "No owner";
  if (owner.throughArea !== undefined) {
    return `Owned through ${owner.throughArea} · ${owner.mine ? "you" : owner.name}`;
  }
  return `Owner ${owner.name}${owner.mine ? " (you)" : ""}`;
}

/** What a person may do with a task's owner. */
export interface OwnerActions {
  /** Name or clear it: the project's leads and the workspace's admins. */
  readonly set: boolean;
  /** Pass it to another member, or give it back: its own owner, not one who owns it through its area. */
  readonly handOver: boolean;
  readonly giveBack: boolean;
}

/** Who may change a task's owner, as the Hub decides it; anyone else's change is refused. */
export function ownerActions(
  ownership: ProjectOwnership | undefined,
  owner: TaskOwnerView | undefined,
): OwnerActions {
  if (ownership === undefined) return { set: false, handOver: false, giveBack: false };
  const own = owner !== undefined && owner.mine && owner.throughArea === undefined;
  return { set: ownership.canManage, handOver: own, giveBack: own };
}

/** Whom a task in review asks, and whether that is the person looking. */
export interface ReviewRoute {
  /** The task's effective owner, else the project's leads, else every member. */
  readonly audience: "owner" | "leads" | "everyone";
  readonly forMe: boolean;
  /** Whom it asks, by name: the owner, or the leads; empty when it asks every member. */
  readonly names: ReadonlyArray<string>;
}

/**
 * Whom a review asks: the task's effective owner only; with none, the project's leads; and where
 * the project has no leads, every member, as before ownership. Without ownership it asks everyone.
 */
export function reviewRoute(
  ownership: ProjectOwnership | undefined,
  owner: TaskOwnerView | undefined,
): ReviewRoute {
  const everyone: ReviewRoute = { audience: "everyone", forMe: true, names: [] };
  if (ownership === undefined) return everyone;
  if (owner !== undefined) return { audience: "owner", forMe: owner.mine, names: [owner.name] };
  const leads = projectLeads(ownership);
  if (leads.length === 0) return everyone;
  return {
    audience: "leads",
    forMe: ownership.me !== null && leads.includes(ownership.me),
    names: leads.map((lead) => ownerName(ownership, lead)),
  };
}

/**
 * Whether a review of a task owned by `owner` (undefined: nobody) asks `person`, an address in
 * lower case: the owner only; with none, the project's leads; where it has none, every member.
 */
export function reviewAsks(
  ownership: ProjectOwnership,
  owner: Pick<TaskOwnerView, "email"> | undefined,
  person: string,
): boolean {
  if (owner !== undefined) return owner.email === person;
  const leads = projectLeads(ownership);
  return leads.length === 0 || leads.includes(person);
}

/**
 * Whether a call still waits for a decision at `now`. The Hub reads a pending call past its
 * expiry as expired, but only as of when it made its view.
 */
export function callIsPending(call: PeerOwnerCall, now: number): boolean {
  return call.state === "pending" && Date.parse(call.expiresAt) > now;
}

/** A call that waits on a person, and whether they would decide it for an owner who left. */
export interface OwnerCallNeed {
  readonly call: PeerOwnerCall;
  readonly onBehalf: boolean;
}

/**
 * The calls waiting on `person` (an address in lower case): those to them, and, for a lead of the
 * project, those to an owner who left. Nobody decides a call their own agent opened, so those are
 * not theirs to decide.
 */
export function ownerCallsWaitingOn(
  ownership: ProjectOwnership,
  person: string,
  now: number,
): ReadonlyArray<OwnerCallNeed> {
  const lead = projectLeads(ownership).includes(person);
  return ownership.view.calls.flatMap((call): OwnerCallNeed[] => {
    if (!callIsPending(call, now) || call.email === person) return [];
    if (call.owner === person) return [{ call, onBehalf: false }];
    return lead && !ownership.people.has(call.owner) ? [{ call, onBehalf: true }] : [];
  });
}

/** What a person may do with a call. */
export interface CallActions {
  /**
   * Whom they would decide as: the owner, or, for a lead or an admin, on the owner's behalf. Undefined
   * where they may not: the call is decided, or their own agent opened it.
   */
  readonly decide: "owner" | "on-behalf" | undefined;
  /** Their own agent opened it and it still waits: they take it back. */
  readonly withdraw: boolean;
}

/** Who may decide or withdraw a call, as the Hub decides it. */
export function callActions(
  ownership: ProjectOwnership,
  call: PeerOwnerCall,
  now: number,
): CallActions {
  const { me } = ownership;
  if (me === null || !callIsPending(call, now)) return { decide: undefined, withdraw: false };
  if (call.email === me) return { decide: undefined, withdraw: true };
  if (call.owner === me) return { decide: "owner", withdraw: false };
  return { decide: ownership.canManage ? "on-behalf" : undefined, withdraw: false };
}

/** The calls still waiting for a decision that are about a task. */
export function pendingCallsOn(
  ownership: ProjectOwnership | undefined,
  task: string,
  now: number,
): ReadonlyArray<PeerOwnerCall> {
  return (ownership?.view.calls ?? []).filter(
    (call) => call.task === task && callIsPending(call, now),
  );
}

/** A change an agent made in a path somebody else owns. */
export interface OwnedPathChange {
  /** The person whose agent made it. */
  readonly person: string;
  readonly task: string | undefined;
  readonly path: string;
  /** The path's owner, and the pattern that makes them so. */
  readonly owner: string;
  readonly pattern: string;
  /** The owner decides changes by others here. */
  readonly decides: boolean;
  /** The owner decides, and no accepted call covers the change: its landing waits for one. */
  readonly waitsForCall: boolean;
  /** A call that still waits for the owner's decision names the path: the agent asked. */
  readonly asked: boolean;
}

/**
 * The changes the project's agents made in paths of other people, from the files their sessions
 * report: where the owner decides and no accepted call covers it, the change cannot land. A
 * session never counts against its own person's paths.
 */
export function ownedPathChanges(
  ownership: ProjectOwnership,
  sessions: ReadonlyArray<PeerCoordSession>,
  now: number,
): ReadonlyArray<OwnedPathChange> {
  const { view, people } = ownership;
  return sessions.flatMap((session) => {
    if (session.workspace !== ownership.workspace || session.project !== ownership.project) {
      return [];
    }
    const person = session.email.toLowerCase();
    return session.files.flatMap((path): OwnedPathChange[] => {
      const found = pathOwner(view.map, path, people);
      if (found === undefined || found.owner === person) return [];
      const decides = ownerDecides(view.map, path);
      return [
        {
          person,
          task: session.task,
          path,
          owner: found.owner,
          pattern: found.pattern,
          decides,
          waitsForCall: decides && !view.calls.some((call) => callCovers(call, session, path)),
          asked: view.calls.some(
            (call) => callIsPending(call, now) && callAbout(call, session) && callNames(call, path),
          ),
        },
      ];
    });
  });
}
