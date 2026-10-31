import type { RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { PeerRoomMessage } from "@t3tools/contracts";

/**
 * One room across projects is one chat per project with a `group` mark in common. Each stays an
 * ordinary room, so runs, capacity, diffs and who may read it stay per project; the app reads them
 * as one conversation and a message goes to each project it names.
 */
export interface SharedRoomMember {
  readonly place: RoomPlace;
  readonly project: string;
  readonly title: string;
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
          readonly group?: string | undefined;
        }>;
      };
    }>;
  }>;
}

const openMembers = (
  status: StatusWorkspaces,
): ReadonlyArray<SharedRoomMember & { group: string }> =>
  status.workspaces.flatMap((workspace) =>
    workspace.projects.flatMap((state) =>
      state.work.tasks.flatMap((task) =>
        task.group === undefined || task.status === "done"
          ? []
          : [
              {
                group: task.group,
                place: { workspace: workspace.slug, project: state.project.id, task: task.id },
                project: state.project.name,
                title: task.title,
              },
            ],
      ),
    ),
  );

/** The rooms of a group the reader can see: a project they are not on simply is not here. */
export const sharedRoomMembers = (
  status: StatusWorkspaces,
  group: string,
): ReadonlyArray<SharedRoomMember> => openMembers(status).filter((row) => row.group === group);

/** The shared rooms that touch these projects (`<workspace>/<project>`), each once. */
export function sharedRoomsOf(
  status: StatusWorkspaces,
  projects: ReadonlyArray<string>,
): ReadonlyArray<{ readonly group: string; readonly title: string }> {
  const rooms = new Map<string, string>();
  for (const row of openMembers(status)) {
    if (projects.includes(`${row.place.workspace}/${row.place.project}`)) {
      rooms.set(row.group, row.title);
    }
  }
  return [...rooms].map(([group, title]) => ({ group, title }));
}

export interface SharedRow {
  readonly place: RoomPlace;
  readonly project: string;
  readonly echo: boolean;
}

/** A message posted to several projects lands in each within this. */
const ECHO_MS = 60_000;

/**
 * The rooms' messages in one timeline, each with the room it is really in. The same words from the
 * same author right after themselves in another project are one message posted to both: the row
 * stays, for its delivery there, without repeating the text.
 */
export function sharedTimeline(
  rooms: ReadonlyArray<{
    readonly member: SharedRoomMember;
    readonly messages: ReadonlyArray<PeerRoomMessage>;
  }>,
): {
  readonly messages: ReadonlyArray<PeerRoomMessage>;
  readonly rows: Map<PeerRoomMessage, SharedRow>;
} {
  const all = rooms
    .flatMap(({ member, messages }) => messages.map((message) => ({ member, message })))
    .toSorted((a, b) => Date.parse(a.message.at) - Date.parse(b.message.at));
  const rows = new Map<PeerRoomMessage, SharedRow>();
  all.forEach(({ member, message }, index) => {
    const before = all[index - 1];
    const echo =
      before !== undefined &&
      before.member.place.project !== member.place.project &&
      before.message.text === message.text &&
      before.message.author.email === message.author.email &&
      before.message.author.run === message.author.run &&
      Date.parse(message.at) - Date.parse(before.message.at) < ECHO_MS;
    rows.set(message, { place: member.place, project: member.project, echo });
  });
  return { messages: all.map(({ message }) => message), rows };
}
