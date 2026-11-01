import { personName } from "@t3tools/client-runtime/peer/needs-you";
import { targetsFor, type RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { EnvironmentId, PeerHubStatus, PeerProjectState } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { randomUUID } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useCurrentProjectSets } from "../projectScope";
import { setOfRoom, setScope } from "../projectSets.logic";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { PeerPageHeader } from "../PeerPageHeader";
import { useWorkData } from "../useWorkData";
import { useWorkScope } from "../workScope";
import { failureMessage } from "../WorkspaceAccess";
import type { WorkProjectNode } from "../workTree.logic";
import { chatTitle } from "./DraftChat";
import { findTask, peopleOf } from "./room.logic";
import { RoomComposer } from "./RoomComposer";
import { RoomProjects } from "./RoomProjects";
import { RoomBody, type RoomChat } from "./RoomView";
import {
  markedProjects,
  plannedChips,
  roomChips,
  roomName,
  scopeOfPlace,
  sharedRoomOf,
  toggledMarks,
  type PlannedProject,
  type SharedRoomMember,
} from "./sharedRoom.logic";

const NOTHING = () => undefined;

const stateOf = (
  status: PeerHubStatus,
  place: Pick<RoomPlace, "workspace" | "project">,
): PeerProjectState | undefined =>
  status.workspaces
    .find((workspace) => workspace.slug === place.workspace)
    ?.projects.find((state) => state.project.id === place.project);

/** A chat of the room with what its page reads of it, once the status has reached it. */
function chatOf(
  status: PeerHubStatus,
  tree: ReadonlyArray<WorkProjectNode>,
  member: SharedRoomMember,
): RoomChat | undefined {
  const state = stateOf(status, member.place);
  const hubTask = state?.work.tasks.find((candidate) => candidate.id === member.place.task);
  const task = findTask(tree, member.place)?.task;
  return state === undefined || hubTask === undefined || task === undefined
    ? undefined
    : { place: member.place, project: member.project, state, hubTask, task };
}

/**
 * One room across a workspace's projects: the room of its home chat, with each project's work beside
 * the conversation. It is the same page as a task's room, so what one gains the other has.
 */
export function SharedRoomView({ group }: { readonly group: string }) {
  const { environmentId, status, tree, actions } = useWorkData();
  const navigate = useNavigate();
  const sets = useCurrentProjectSets();
  const [stored, setStored] = useWorkScope();
  const updateTask = useAtomCommand(serverEnvironment.peerHubUpdateTask, { reportFailure: false });
  const room = status === null ? null : sharedRoomOf(status, group);
  const members = room === null ? [] : [room.home, ...room.others];
  const set = setOfRoom(
    members.map((member) => scopeOfPlace(member.place)),
    stored,
    sets,
  );
  const home = status === null || room === null ? undefined : chatOf(status, tree, room.home);
  // A room is its workspace's, however it was opened, so the sidebar shows all its projects.
  const workspaceScope = set === undefined ? null : setScope(set.id);
  const followScope = useEffectEvent((scope: string | null) => {
    if (scope !== null && scope !== stored) setStored(scope);
  });
  useEffect(() => {
    followScope(workspaceScope);
  }, [workspaceScope]);
  const closeAll = async () => {
    if (environmentId === null) return;
    await Promise.all(
      members.map(({ place }) =>
        updateTask({
          environmentId,
          input: {
            workspace: place.workspace,
            projectId: place.project,
            taskId: place.task,
            status: "done",
          },
        }),
      ),
    );
    await (set === undefined
      ? navigate({ to: "/" })
      : navigate({ to: "/workspace/$setId", params: { setId: set.id } }));
  };
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={
            room === null
              ? undefined
              : {
                  name: roomName(set, roomChips(members, [], set)),
                  colorKey: set === undefined ? scopeOfPlace(room.home.place) : setScope(set.id),
                }
          }
          task={room === null ? undefined : { title: room.home.title }}
          page="Room"
          {...(room === null
            ? {}
            : {
                actions: (
                  <Button size="sm" variant="ghost" onClick={() => void closeAll()}>
                    Close room
                  </Button>
                ),
              })}
        />
        {status === null || environmentId === null ? (
          <p role="status" className="px-6 py-6 text-sm text-muted-foreground">
            Connecting…
          </p>
        ) : status.email === null ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            Sign in to the Hub to read this room.
          </p>
        ) : room === null || home === undefined ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">This room is closed.</p>
        ) : (
          <RoomBody
            key={group}
            environmentId={environmentId}
            status={status}
            me={status.email}
            place={home.place}
            projectState={home.state}
            hubTask={home.hubTask}
            taskNode={home.task}
            onOpen={actions.open}
            across={{
              others: room.others.flatMap((member) => chatOf(status, tree, member) ?? []),
              closed: room.closed,
              set,
            }}
          />
        )}
      </div>
    </SidebarInset>
  );
}

/**
 * Starts a room across a workspace's projects: the first message makes its chats, home first, and
 * goes there, and the agent it names works in every project still marked. Rooms live on the Hub, so
 * a workspace needs one shared project; the rest can be folders of this computer.
 */
export function NewSharedRoom({
  setId,
  environmentId,
  status,
  planned,
}: {
  readonly setId: string;
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly planned: ReadonlyArray<PlannedProject>;
}) {
  const navigate = useNavigate();
  const createTask = useAtomCommand(serverEnvironment.peerHubCreateTask, { reportFailure: false });
  const saveFolders = useAtomCommand(serverEnvironment.peerRooms.folders, { reportFailure: false });
  const group = useRef(randomUUID());
  const [unmarked, setUnmarked] = useState<ReadonlySet<string>>(new Set());
  // A post that fails keeps the chats it made, so sending again adds no second one, and what they
  // settled stays: a project left out now would keep its chat, and its agent would still work there.
  const created = useRef<ReadonlyMap<string, RoomPlace>>(new Map());
  const [settled, setSettled] = useState(false);
  const marked = markedProjects(planned, unmarked);
  const places = marked.flatMap(({ place }) => place ?? []);
  const first = places[0];
  const state = first === undefined ? undefined : stateOf(status, first);
  const me = status.email;
  if (first === undefined || state === undefined || me === null) {
    return (
      <div className="flex flex-col gap-1 px-4 py-5 text-sm text-muted-foreground">
        <p>A room lives on the Hub, so a workspace needs a project shared with your team.</p>
        <p>
          Share one from the project button&rsquo;s menu, and its agent can work in all of them.
        </p>
      </div>
    );
  }
  const nameOf = (email: string) => personName(state, email);
  const folders = marked.flatMap(({ name, folder }) =>
    folder === undefined ? [] : [{ name, folder }],
  );
  const prepare = async (text: string) => {
    const made = new Map(created.current);
    // One at a time, home first: a room lives in its oldest chat.
    for (const { workspace, project } of places) {
      if (made.has(project)) continue;
      const result = await createTask({
        environmentId,
        input: {
          workspace,
          projectId: project,
          title: chatTitle(text),
          chat: true,
          group: group.current,
        },
      });
      if (result._tag !== "Success")
        throw new Error(failureMessage(result) ?? "The room could not be started.");
      const task = result.value.createdTask?.id;
      if (task === undefined) throw new Error("The Hub did not start the room.");
      made.set(project, { workspace, project, task });
      created.current = made;
      setSettled(true);
    }
    const saved = await saveFolders({ environmentId, input: { group: group.current, folders } });
    if (saved._tag !== "Success")
      throw new Error(failureMessage(saved) ?? "The room could not be started.");
    return made.get(first.project)!;
  };
  const chips = plannedChips(planned, unmarked);
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4">
      <h1 className="text-center text-2xl font-medium text-foreground">
        What should we build across these projects?
      </h1>
      <RoomComposer
        environmentId={environmentId}
        place={{ workspace: "set", project: setId, task: "new-shared-room" }}
        targets={targetsFor(state.project, { id: "", createdBy: me }, [], me, {
          nameOf,
          chat: true,
          across: marked.map(({ name }) => name),
        })}
        people={peopleOf(state.project.members, me, nameOf)}
        line={null}
        paths={null}
        toOwnAgent
        prepare={prepare}
        placeholder="Write to your agents or anyone on the projects. @ names a person."
        scope={
          <RoomProjects
            projects={chips}
            {...(settled
              ? {}
              : { onToggle: (scope) => setUnmarked(toggledMarks(planned, unmarked, scope)) })}
          />
        }
        across={marked.map(({ name }) => name)}
        onDrafting={NOTHING}
        onSent={() => void navigate({ to: "/together/$group", params: { group: group.current } })}
      />
      {folders.length === 0 ? null : (
        <p className="text-center text-xs text-muted-foreground">
          {folders.map((one) => one.name).join(", ")}: on this computer only, so your team and
          coordination do not see that work.
        </p>
      )}
    </div>
  );
}
