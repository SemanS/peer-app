import type { RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { PeerCheckoutState, PeerRoomMessage } from "@t3tools/contracts";

import { isLocalScope, type ResolvedProjectScope } from "../projectScope.logic";
import type { ProjectSet } from "../projectSets.logic";

/**
 * One room across projects is one chat per project with a `group` mark in common. One chat is its
 * home: what is written goes there and its agent's run starts there, with a checkout of its own in
 * every other project. The other chats hold that project's rights and the place of its work, so
 * runs and diffs stay per project, and a reader on one project just sees that part.
 */
export interface SharedRoomMember {
  readonly place: RoomPlace;
  readonly project: string;
  readonly title: string;
  readonly createdAt: string;
  /** Done: its words stay in the conversation, but nothing works there any more. */
  readonly closed: boolean;
}

interface StatusWorkspaces {
  readonly workspaces: ReadonlyArray<{
    readonly slug: string;
    readonly projects: ReadonlyArray<{
      readonly project: { readonly id: string; readonly name: string };
      readonly work: {
        readonly tasks: ReadonlyArray<{
          readonly id: string;
          readonly title: string;
          readonly status: string;
          readonly createdAt: string;
          readonly group?: string | undefined;
        }>;
      };
    }>;
  }>;
}

const groupedMembers = (
  status: StatusWorkspaces,
): ReadonlyArray<SharedRoomMember & { group: string }> =>
  status.workspaces.flatMap((workspace) =>
    workspace.projects.flatMap((state) =>
      state.work.tasks.flatMap((task) =>
        task.group === undefined
          ? []
          : [
              {
                group: task.group,
                place: { workspace: workspace.slug, project: state.project.id, task: task.id },
                project: state.project.name,
                title: task.title,
                createdAt: task.createdAt,
                closed: task.status === "done",
              },
            ],
      ),
    ),
  );

/**
 * A room as its reader sees it, or null once no chat of it is open: a project they are not on simply
 * is not here. Its home is its oldest open chat, as a room makes its chats one by one and posts to
 * the first. Should that one close, the room goes on in the next, with the agent started there.
 */
export function sharedRoomOf(status: StatusWorkspaces, group: string) {
  const members = groupedMembers(status)
    .filter((row) => row.group === group)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [home, ...others] = members.filter((member) => !member.closed);
  return home === undefined
    ? null
    : { home, others, closed: members.filter((member) => member.closed) };
}

export const scopeOfPlace = (place: Pick<RoomPlace, "workspace" | "project">) =>
  `${place.workspace}/${place.project}`;

/** The shared rooms that touch these projects (`<workspace>/<project>`), each once. */
export function sharedRoomsOf(status: StatusWorkspaces, projects: ReadonlyArray<string>) {
  const rooms = new Set(
    groupedMembers(status)
      .filter((row) => !row.closed && projects.includes(scopeOfPlace(row.place)))
      .map((row) => row.group),
  );
  return [...rooms].flatMap((group) => {
    const room = sharedRoomOf(status, group);
    if (room === null) return [];
    return [
      {
        group,
        title: room.home.title,
        projects: [room.home, ...room.others].map((member) => ({
          scope: scopeOfPlace(member.place),
          name: member.project,
        })),
      },
    ];
  });
}

export interface SharedRow {
  readonly place: RoomPlace;
  /** Its project, where that is not the room's home: an agent wrote from that project's folder. */
  readonly project: string | undefined;
}

/** The rooms' messages in one timeline, each with the room it is really in. */
export function sharedTimeline(
  rooms: ReadonlyArray<{
    readonly member: Pick<SharedRoomMember, "place" | "project">;
    readonly messages: ReadonlyArray<PeerRoomMessage>;
  }>,
  home: RoomPlace,
): {
  readonly messages: ReadonlyArray<PeerRoomMessage>;
  readonly rows: Map<PeerRoomMessage, SharedRow>;
} {
  const all = rooms
    .flatMap(({ member, messages }) => messages.map((message) => ({ member, message })))
    .toSorted((a, b) => Date.parse(a.message.at) - Date.parse(b.message.at));
  const rows = new Map<PeerRoomMessage, SharedRow>();
  for (const { member, message } of all) {
    rows.set(message, {
      place: member.place,
      project: member.place.project === home.project ? undefined : member.project,
    });
  }
  return { messages: all.map(({ message }) => message), rows };
}

/** A workspace's project as a new room would reach it from this computer. */
export interface PlannedProject {
  readonly scope: string;
  readonly name: string;
  /** Gets a chat in the room: its rights, coordination and diff stay that project's. */
  readonly place?: Pick<RoomPlace, "workspace" | "project">;
  /** Only a folder here: the agent works in it, but no coordination hears of that. */
  readonly folder?: string;
  /** Why the agent cannot reach it. */
  readonly away?: string;
}

interface StatusCheckouts {
  readonly workspaces: ReadonlyArray<{
    readonly slug: string;
    readonly projects: ReadonlyArray<{
      readonly project: { readonly id: string };
      readonly repositories: ReadonlyArray<{ readonly state: PeerCheckoutState }>;
    }>;
  }>;
}

/**
 * What a new room does with each of a workspace's projects. One agent runs in one Hub workspace, so
 * the first project with a checkout here settles which; a project shared elsewhere, or not at all,
 * joins as a folder. `folderOf` says where a project is open on this computer.
 */
export function plannedProjects(
  members: ReadonlyArray<ResolvedProjectScope>,
  status: StatusCheckouts,
  folderOf: (member: ResolvedProjectScope) => string | null,
): ReadonlyArray<PlannedProject> {
  const shared = (scope: string) => {
    if (isLocalScope(scope)) return undefined;
    const [workspace, project] = scope.split("/");
    const state = status.workspaces
      .find((candidate) => candidate.slug === workspace)
      ?.projects.find((candidate) => candidate.project.id === project);
    return workspace === undefined ||
      project === undefined ||
      state?.repositories.some((repository) => repository.state === "ready") !== true
      ? undefined
      : { workspace, project };
  };
  const hub = members.map(({ scope }) => shared(scope)).find((place) => place !== undefined);
  return members.map((member) => {
    const { scope } = member;
    const name = member.name ?? scope;
    const place = shared(scope);
    if (place !== undefined && place.workspace === hub?.workspace) return { scope, name, place };
    const folder = folderOf(member);
    return folder === null
      ? { scope, name, away: "This computer has no checkout of it." }
      : { scope, name, folder };
  });
}

/** What the agent of a new room works in, once the person left out `unmarked`. */
export const markedProjects = (
  planned: ReadonlyArray<PlannedProject>,
  unmarked: ReadonlySet<string>,
) => planned.filter(({ scope, away }) => away === undefined && !unmarked.has(scope));

/** Marks or leaves out a project; the last one with a chat stays, as the room lives in it. */
export function toggledMarks(
  planned: ReadonlyArray<PlannedProject>,
  unmarked: ReadonlySet<string>,
  scope: string,
): ReadonlySet<string> {
  const next = new Set(unmarked);
  if (next.delete(scope)) return next;
  next.add(scope);
  return markedProjects(planned, next).some(({ place }) => place !== undefined) ? next : unmarked;
}

/** A project in the `In` row beside the composer. */
export interface RoomProjectChip {
  readonly key: string;
  readonly name: string;
  readonly colorKey: string;
  readonly marked: boolean;
  /** Why the agent cannot reach it. */
  readonly away?: string;
  /** Only a folder on this computer, so no coordination hears of the work there. */
  readonly folder: boolean;
}

export const plannedChips = (
  planned: ReadonlyArray<PlannedProject>,
  unmarked: ReadonlySet<string>,
): ReadonlyArray<RoomProjectChip> =>
  planned.map(({ scope, name, folder, away }) => ({
    key: scope,
    name,
    colorKey: scope,
    marked: away === undefined && !unmarked.has(scope),
    ...(away === undefined ? {} : { away }),
    folder: folder !== undefined,
  }));

/** The projects of a room that runs, in its workspace's order where a workspace holds them. */
export function roomChips(
  members: ReadonlyArray<
    Pick<SharedRoomMember, "place" | "project"> & { readonly away?: string | undefined }
  >,
  folders: ReadonlyArray<string>,
  set: ProjectSet | undefined,
): ReadonlyArray<RoomProjectChip> {
  const order = (scope: string) => {
    const at = set?.projects.indexOf(scope) ?? -1;
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  // A folder stays stored after its project is shared, and the project is a member then.
  const beyond = folders.filter((name) => !members.some((member) => member.project === name));
  return [
    ...members
      .map((member) => ({
        key: scopeOfPlace(member.place),
        name: member.project,
        colorKey: scopeOfPlace(member.place),
        marked: member.away === undefined,
        ...(member.away === undefined ? {} : { away: member.away }),
        folder: false,
      }))
      .toSorted((a, b) => order(a.key) - order(b.key)),
    ...beyond.map((name) => ({ key: name, name, colorKey: name, marked: true, folder: true })),
  ];
}

/** The people's name for a room's projects: its workspace, else the projects themselves. */
export const roomName = (set: ProjectSet | undefined, chips: ReadonlyArray<RoomProjectChip>) =>
  set?.name ?? chips.map((chip) => chip.name).join(" + ");

/** A run's projects by name, its own first: a run only names the projects besides its own. */
export const runProjectNames = (
  home: string,
  run: ReadonlyArray<string> | undefined,
  members: ReadonlyArray<Pick<SharedRoomMember, "place" | "project">>,
): ReadonlyArray<string> =>
  run === undefined || run.length === 0
    ? []
    : [
        home,
        ...run.map((id) => members.find((member) => member.place.project === id)?.project ?? id),
      ];
