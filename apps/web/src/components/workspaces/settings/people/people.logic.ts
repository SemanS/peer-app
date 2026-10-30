/**
 * What the People page says of each person, apart from how it draws: one list where an invitation
 * is a person's state, the access a person has in plain words, and the work of a project as areas
 * and tasks to tick. The Hub decides every change again; these only shape what the page offers.
 */
import type { PeerInvitation, PeerTask, PeerWorkspaceMembers } from "@t3tools/contracts";
import { invitationView, sortInvitations } from "@t3tools/client-runtime/peer-organizations";

type Member = PeerWorkspaceMembers["members"][number];
type Removed = NonNullable<PeerWorkspaceMembers["removed"]>[number];

export type PersonState = "active" | "invited" | "expired" | "removed";

/** The list's filter: everyone, or one state, an expired invitation among the invited. */
export type PeopleFilter = "all" | "active" | "invited" | "removed";

export const PEOPLE_FILTERS: ReadonlyArray<{ readonly id: PeopleFilter; readonly label: string }> =
  [
    { id: "all", label: "All people" },
    { id: "active", label: "Active" },
    { id: "invited", label: "Invited" },
    { id: "removed", label: "Removed" },
  ];

export interface PersonRow {
  readonly email: string;
  readonly name: string | null;
  readonly state: PersonState;
  /** "Member · Formbricks", "Invited · All projects". */
  readonly summary: string;
  readonly stateLabel: string;
  readonly member: Member | null;
  readonly invitation: PeerInvitation | null;
  readonly removed: Removed | null;
}

/** Two letters for a person's mark: of their name's words, else of their address. */
export function initials(name: string | null, email: string): string {
  const words = (name ?? "").trim().split(/\s+/u).filter(Boolean);
  const letters =
    words.length >= 2
      ? `${words[0]!.charAt(0)}${words.at(-1)!.charAt(0)}`
      : (words[0] ?? email).slice(0, 2);
  return letters.toUpperCase();
}

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** The access a list of projects means: every project without a list, else their names. */
export function accessText(
  projects: ReadonlyArray<string> | null | undefined,
  nameOf: (project: string) => string | undefined,
): string {
  if (projects === null || projects === undefined) return "All projects";
  if (projects.length === 0) return "No project yet";
  return projects.map((id) => nameOf(id) ?? id).join(", ");
}

/**
 * Everyone the workspace knows of, once each: members first, then open invitations and people who
 * were removed. An accepted invitation is its member's row and a revoked one is nobody's. From a
 * Hub that does not list invitations (`invitations` null), the members answer's pending ones.
 */
export function peopleRows(input: {
  readonly members: PeerWorkspaceMembers | null;
  readonly invitations: ReadonlyArray<PeerInvitation> | null;
  readonly projectName: (id: string) => string | undefined;
  readonly now: number;
}): ReadonlyArray<PersonRow> {
  const { members, projectName, now } = input;
  const joined = (members?.members ?? []).map((member): PersonRow => {
    const all = member.role !== "member";
    return {
      email: member.email,
      name: member.name ?? null,
      state: "active",
      summary: `${capitalized(member.role)} · ${accessText(all ? null : member.projects, projectName)}`,
      stateLabel: "Active",
      member,
      invitation: null,
      removed: null,
    };
  });
  const known = new Set(joined.map((row) => row.email.toLowerCase()));
  const listed =
    input.invitations ??
    (members?.invites ?? []).map((invite) => ({ ...invite, status: "pending" as const }));
  const invited = sortInvitations(listed as ReadonlyArray<PeerInvitation>, now).flatMap(
    (invitation): ReadonlyArray<PersonRow> => {
      if (known.has(invitation.email.toLowerCase())) return [];
      const view = invitationView(invitation, now);
      if (view.status !== "pending" && view.status !== "expired") return [];
      const expired = view.status === "expired";
      return [
        {
          email: invitation.email,
          name: null,
          state: expired ? "expired" : "invited",
          summary: `Invited · ${accessText(invitation.projects?.length ? invitation.projects : null, projectName)}`,
          stateLabel: expired ? "Expired" : "Pending",
          member: null,
          invitation,
          removed: null,
        },
      ];
    },
  );
  const gone = (members?.removed ?? []).map((removed): PersonRow => ({
    email: removed.email,
    name: null,
    state: "removed",
    summary: "No access",
    stateLabel: "Removed",
    member: null,
    invitation: null,
    removed,
  }));
  return [...joined, ...invited, ...gone];
}

/** The rows a search and a filter leave. */
export function filterPeople(
  rows: ReadonlyArray<PersonRow>,
  search: string,
  filter: PeopleFilter,
): ReadonlyArray<PersonRow> {
  const words = search.trim().toLowerCase();
  return rows.filter((row) => {
    const inFilter =
      filter === "all" ||
      (filter === "invited"
        ? row.state === "invited" || row.state === "expired"
        : row.state === filter);
    if (!inFilter || words === "") return inFilter;
    return `${row.name ?? ""} ${row.email} ${row.summary}`.toLowerCase().includes(words);
  });
}

/** What the empty list says, by why it is empty. */
export function noPeopleText(search: string, filter: PeopleFilter): string {
  if (search.trim() !== "") return `Nobody matches “${search.trim()}”.`;
  return filter === "all" ? "Nobody here yet. Invite someone to start." : "Nobody in this view.";
}

/** The access chosen in a form: every project, or the ones ticked. */
export type ProjectAccess =
  | { readonly mode: "all" }
  | { readonly mode: "selected"; readonly projects: ReadonlyArray<string> };

export const accessOf = (limit: ReadonlyArray<string> | null | undefined): ProjectAccess =>
  limit === null || limit === undefined ? { mode: "all" } : { mode: "selected", projects: limit };

/** What a save sends for it: the list of projects, or null for every project. */
export const limitOf = (access: ProjectAccess): ReadonlyArray<string> | null =>
  access.mode === "all" ? null : access.projects;

/** One heading of the work to tick: an area, or a group of an imported tree. */
export interface WorkGroup {
  readonly id: string;
  readonly title: string;
  /** The area ticking the whole group hands over, which covers its later tasks too. */
  readonly area: string | null;
  readonly tasks: ReadonlyArray<{ readonly id: string; readonly title: string }>;
}

/**
 * A project's open work as groups: a task under a group task sits in that group, any other in its
 * area, the rest under Other tasks. Done tasks and groups themselves are not work to hand over.
 */
export function workGroups(work: {
  readonly areas: ReadonlyArray<string>;
  readonly tasks: ReadonlyArray<PeerTask>;
}): ReadonlyArray<WorkGroup> {
  const parents = new Map(
    work.tasks.filter((task) => task.kind === "group").map((task) => [task.id, task.title]),
  );
  const open = work.tasks.filter(
    (task) => task.kind !== "group" && task.executable !== false && task.status !== "done",
  );
  const rows = (keep: (task: PeerTask) => boolean) =>
    open.filter(keep).map((task) => ({ id: task.id, title: task.title }));
  const grouped = (task: PeerTask) => task.parent !== undefined && parents.has(task.parent);
  const named = [...parents].map(([id, title]): WorkGroup => ({
    id: `group:${id}`,
    title,
    area: null,
    tasks: rows((task) => task.parent === id),
  }));
  const areas = work.areas.map((area): WorkGroup => ({
    id: `area:${area}`,
    title: area,
    area,
    tasks: rows((task) => !grouped(task) && task.area === area),
  }));
  const known = new Set(work.areas);
  const rest: WorkGroup = {
    id: "rest",
    title: "Other tasks",
    area: null,
    tasks: rows((task) => !grouped(task) && (task.area === undefined || !known.has(task.area))),
  };
  return [...named, ...areas, rest].filter(
    (group) => group.tasks.length > 0 || group.area !== null,
  );
}

/** The work ticked: whole areas, and tasks outside them. */
export interface WorkPick {
  readonly areas: ReadonlyArray<string>;
  readonly tasks: ReadonlyArray<string>;
}

export const NO_WORK: WorkPick = { areas: [], tasks: [] };

export const isPicked = (pick: WorkPick, group: WorkGroup, task: string): boolean =>
  pick.tasks.includes(task) || (group.area !== null && pick.areas.includes(group.area));

/** How many of a group's tasks are ticked. */
export const pickedIn = (pick: WorkPick, group: WorkGroup): number =>
  group.tasks.filter((task) => isPicked(pick, group, task.id)).length;

export function isGroupPicked(pick: WorkPick, group: WorkGroup): boolean {
  if (group.area !== null && pick.areas.includes(group.area)) return true;
  return group.tasks.length > 0 && pickedIn(pick, group) === group.tasks.length;
}

/** Ticks or unticks a whole group: an area as the area, any other as its tasks. */
export function pickGroup(pick: WorkPick, group: WorkGroup, on: boolean): WorkPick {
  const inGroup = new Set(group.tasks.map((task) => task.id));
  const tasks = pick.tasks.filter((id) => !inGroup.has(id));
  if (group.area === null) return { areas: pick.areas, tasks: on ? [...tasks, ...inGroup] : tasks };
  const areas = pick.areas.filter((area) => area !== group.area);
  return { areas: on ? [...areas, group.area] : areas, tasks };
}

/** Ticks or unticks one task; unticking a task of a whole area keeps the area's other tasks. */
export function pickTask(pick: WorkPick, group: WorkGroup, task: string, on: boolean): WorkPick {
  if (group.area !== null && pick.areas.includes(group.area)) {
    if (on) return pick;
    return {
      areas: pick.areas.filter((area) => area !== group.area),
      tasks: [...pick.tasks, ...group.tasks.map((entry) => entry.id).filter((id) => id !== task)],
    };
  }
  const tasks = pick.tasks.filter((id) => id !== task);
  return { areas: pick.areas, tasks: on ? [...tasks, task] : tasks };
}

export function pickAll(groups: ReadonlyArray<WorkGroup>): WorkPick {
  return groups.reduce((pick, group) => pickGroup(pick, group, true), NO_WORK);
}

/** "2 of 4 tasks selected". */
export function pickedCount(pick: WorkPick, groups: ReadonlyArray<WorkGroup>): string {
  const total = groups.reduce((sum, group) => sum + group.tasks.length, 0);
  const picked = groups.reduce((sum, group) => sum + pickedIn(pick, group), 0);
  return `${picked} of ${total} ${total === 1 ? "task" : "tasks"} selected`;
}

/** What assigning work asks of the Hub for one person: owners to set and to clear, and the areas. */
export function workChanges(input: {
  readonly email: string;
  readonly before: WorkPick;
  readonly after: WorkPick;
  readonly areaOwners: Readonly<Record<string, string>>;
}): {
  readonly give: ReadonlyArray<string>;
  readonly takeBack: ReadonlyArray<string>;
  readonly areas: Readonly<Record<string, string>> | null;
} {
  const { email, before, after, areaOwners } = input;
  const give = after.tasks.filter((id) => !before.tasks.includes(id));
  const takeBack = before.tasks.filter((id) => !after.tasks.includes(id));
  const gained = after.areas.filter((area) => !before.areas.includes(area));
  const lost = before.areas.filter((area) => !after.areas.includes(area));
  if (gained.length === 0 && lost.length === 0) return { give, takeBack, areas: null };
  const areas = Object.fromEntries([
    ...Object.entries(areaOwners).filter(([area]) => !lost.includes(area)),
    ...gained.map((area) => [area, email] as const),
  ]);
  return { give, takeBack, areas };
}
