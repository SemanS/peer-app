import { useAtomValue } from "@effect/atom-react";
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import { targetsFor, type RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type {
  EnvironmentId,
  PeerHubStatus,
  PeerProjectState,
  PeerRoomMessage,
  PeerRun,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { randomUUID } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { PeerPageHeader } from "../PeerPageHeader";
import { findTask } from "../task/task.logic";
import { runsRevision } from "../task/runs.logic";
import { useTaskRuns } from "../task/TaskRuns";
import { useWorkData } from "../useWorkData";
import { failureMessage } from "../WorkspaceAccess";
import type { WorkOpen, WorkTaskNode } from "../workTree.logic";
import { peopleOf } from "./room.logic";
import { RoomAgents } from "./RoomAgents";
import { RoomComposer } from "./RoomComposer";
import { RoomConversation } from "./RoomConversation";
import { RoomDiff } from "./RoomDiff";
import { RoomFiles } from "./RoomFiles";
import { watchable } from "./roomDiff.logic";
import { chatTitle } from "./DraftChat";
import { sharedRoomMembers, sharedTimeline, type SharedRoomMember } from "./sharedRoom.logic";
import { useRoom, useRoomDiff, useRoomMoves } from "./useRoom";

const NO_RUNS: ReadonlyArray<string> = [];
const NOTHING = () => undefined;
const OWN_AGENT = { text: "", selected: ["own-agent"] };

const stateOf = (status: PeerHubStatus, place: RoomPlace): PeerProjectState | undefined =>
  status.workspaces
    .find((workspace) => workspace.slug === place.workspace)
    ?.projects.find((state) => state.project.id === place.project);

/** What one project's room gives the shared page. */
interface MemberRead {
  readonly messages: ReadonlyArray<PeerRoomMessage>;
  readonly runs: ReadonlyArray<PeerRun>;
  readonly reviewRuns: ReadonlyArray<string>;
  readonly refresh: () => void;
  readonly now: number;
  readonly error: string | null;
}

/**
 * One room across a workspace's projects: their chats read as one conversation, a message goes to
 * the projects chosen under it, and each project's diff, files and agents stand side by side.
 */
export function SharedRoomView({ group }: { readonly group: string }) {
  const { environmentId, status, tree, actions } = useWorkData();
  const members = status === null ? [] : sharedRoomMembers(status, group);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader page={members[0]?.title ?? "Shared room"} />
        {status === null || environmentId === null ? (
          <p role="status" className="px-6 py-6 text-sm text-muted-foreground">
            Connecting…
          </p>
        ) : status.email === null ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            Sign in to the Hub to read this room.
          </p>
        ) : members.length === 0 ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">This room is closed.</p>
        ) : (
          <SharedRoomBody
            key={group}
            environmentId={environmentId}
            status={status}
            me={status.email}
            members={members}
            taskOf={(place) => findTask(tree, { ...place })?.task}
            onOpen={actions.open}
          />
        )}
      </div>
    </SidebarInset>
  );
}

function SharedRoomBody({
  environmentId,
  status,
  me,
  members,
  taskOf,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly me: string;
  readonly members: ReadonlyArray<SharedRoomMember>;
  readonly taskOf: (place: RoomPlace) => WorkTaskNode | undefined;
  readonly onOpen: (open: WorkOpen) => void;
}) {
  const navigate = useNavigate();
  const [reads, setReads] = useState<ReadonlyMap<string, MemberRead>>(new Map());
  const [side, setSide] = useState<"diff" | "files" | "agents">("diff");
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const updateTask = useAtomCommand(serverEnvironment.peerHubUpdateTask, { reportFailure: false });
  const canPost = useAtomValue(serverEnvironment.peerRooms.post.permissionAtom(environmentId));
  const canMove = useAtomValue(serverEnvironment.peerRooms.pass.permissionAtom(environmentId));
  const moves = useRoomMoves(environmentId, () => {
    for (const read of reads.values()) read.refresh();
  });
  const first = members[0]!;
  const firstState = stateOf(status, first.place);
  const { messages, rows } = sharedTimeline(
    members.map((member) => ({
      member,
      messages: reads.get(member.place.project)?.messages ?? [],
    })),
  );
  const chosen = members.filter((member) => !left.has(member.place.project));
  const closeAll = async () => {
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
    await navigate({ to: "/" });
  };
  const reporter = (project: string) => (read: MemberRead) =>
    setReads((current) => new Map(current).set(project, read));
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section
        aria-label="Conversation"
        className="flex min-h-0 min-w-0 flex-1 flex-col lg:max-w-[42rem] lg:border-e lg:border-border"
      >
        <div className="flex shrink-0 justify-end border-b border-border/60 px-4 py-1">
          <Button size="sm" variant="ghost" onClick={() => void closeAll()}>
            Close room
          </Button>
        </div>
        <RoomConversation
          place={first.place}
          messages={messages}
          total={messages.length}
          me={me}
          nameOf={(email) => (firstState === undefined ? email : personName(firstState, email))}
          head={undefined}
          canAct={canMove}
          moves={moves}
          error={[...reads.values()].find((read) => read.error !== null)?.error ?? null}
          loading={reads.size < members.length}
          now={Math.max(0, ...[...reads.values()].map((read) => read.now))}
          runs={[...reads.values()].flatMap((read) => read.runs)}
          reviewRuns={[...reads.values()].flatMap((read) => read.reviewRuns)}
          jujutsu={false}
          threadWorking={NOTHING}
          selected={null}
          onOpenRun={NOTHING}
          onOpenAnchor={() => setSide("diff")}
          shared={(message) => rows.get(message)}
        />
        {canPost && firstState !== undefined ? (
          <>
            <div
              role="group"
              aria-label="Projects this message goes to"
              className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border px-4 pt-2 sm:px-6"
            >
              <span className="me-1 text-xs text-muted-foreground">In</span>
              {members.map(({ place, project }) => {
                const on = !left.has(place.project);
                return (
                  <Button
                    key={place.project}
                    type="button"
                    size="compact"
                    variant={on ? "outline" : "ghost-muted"}
                    aria-pressed={on}
                    disabled={on && chosen.length === 1}
                    onClick={() =>
                      setLeft((current) => {
                        const next = new Set(current);
                        if (!next.delete(place.project)) next.add(place.project);
                        return next;
                      })
                    }
                  >
                    {project}
                  </Button>
                );
              })}
            </div>
            <RoomComposer
              environmentId={environmentId}
              place={first.place}
              targets={targetsFor(
                firstState.project,
                { id: first.place.task, createdBy: me },
                [],
                me,
                {
                  nameOf: (email) => personName(firstState, email),
                  chat: true,
                },
              )}
              people={peopleOf(firstState.project.members, me, (email) =>
                personName(firstState, email),
              )}
              personalHarnesses={firstState.project.capacity.personalHarnesses}
              line={null}
              paths={null}
              chat
              prepare={() => Promise.resolve(chosen.map((member) => member.place))}
              onDrafting={NOTHING}
              onSent={() => {
                for (const read of reads.values()) read.refresh();
              }}
            />
          </>
        ) : null}
      </section>
      <section aria-label="Projects" className="hidden min-h-0 min-w-0 flex-1 flex-col lg:flex">
        <div className="shrink-0 border-b border-border/60 px-4 py-2">
          <ToggleGroup
            aria-label="Show beside the conversation"
            value={[side]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "diff" || next === "files" || next === "agents") setSide(next);
            }}
          >
            <Toggle value="diff">Diff</Toggle>
            <Toggle value="files">Files</Toggle>
            <Toggle value="agents">Agents</Toggle>
          </ToggleGroup>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 divide-x divide-border overflow-x-auto">
          {members.map((member) => {
            const task = taskOf(member.place);
            const state = stateOf(status, member.place);
            return task === undefined || state === undefined ? null : (
              <MemberColumn
                key={member.place.project}
                environmentId={environmentId}
                status={status}
                me={me}
                member={member}
                state={state}
                task={task}
                side={side}
                messages={reads.get(member.place.project)?.messages ?? []}
                onRead={reporter(member.place.project)}
                onOpen={onOpen}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** One project's room: read here, its messages handed up to the timeline, its work shown in place. */
function MemberColumn({
  environmentId,
  status,
  me,
  member,
  state,
  task,
  side,
  messages,
  onRead,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly me: string;
  readonly member: SharedRoomMember;
  readonly state: PeerProjectState;
  readonly task: WorkTaskNode;
  readonly side: "diff" | "files" | "agents";
  readonly messages: ReadonlyArray<PeerRoomMessage>;
  readonly onRead: (read: MemberRead) => void;
  readonly onOpen: (open: WorkOpen) => void;
}) {
  const { place } = member;
  const nameOf = (email: string) => personName(state, email);
  const revision = runsRevision(task.runs, task.threads);
  const runs = useTaskRuns({
    environmentId,
    workspace: place.workspace,
    projectId: place.project,
    taskId: place.task,
    revision,
  });
  const read = useRoom({ environmentId, status, place, revision });
  const diff = useRoomDiff({ environmentId, place, revision });
  const report = useEffectEvent(onRead);
  const reviewRuns = read.room?.reviewRuns ?? NO_RUNS;
  useEffect(() => {
    report({
      messages: read.messages,
      runs: runs.runs,
      reviewRuns,
      refresh: read.refresh,
      now: read.now,
      error: read.error,
    });
  }, [read.error, read.messages, read.now, read.refresh, reviewRuns, runs.runs]);
  return (
    <section
      aria-label={member.project}
      className="flex min-h-0 min-w-[24rem] flex-1 basis-0 flex-col"
    >
      <h2 className="shrink-0 border-b border-border/60 px-4 py-2 text-sm font-medium text-foreground">
        {member.project}
      </h2>
      {side === "diff" ? (
        <RoomDiff
          diff={diff.diff}
          error={diff.error}
          onRefresh={diff.refresh}
          messages={messages}
          drafting={false}
          focus={null}
          me={me}
          nameOf={nameOf}
          watch={watchable(task.threads)}
          onWatch={onOpen}
          onComment={NOTHING}
          onAddPaths={undefined}
          onOpenMessage={NOTHING}
        />
      ) : side === "files" ? (
        <RoomFiles
          environmentId={environmentId}
          diff={diff.diff}
          error={diff.error}
          projectName={member.project}
          canPost={false}
          revision={revision}
          onRefresh={diff.refresh}
          onAdd={NOTHING}
        />
      ) : (
        <RoomAgents
          environmentId={environmentId}
          status={status}
          projectState={state}
          runs={runs.runs}
          threads={task.threads}
          me={me}
          now={read.now}
          nameOf={nameOf}
          onOpen={onOpen}
          place={place}
          alone
        />
      )}
    </section>
  );
}

/**
 * Starts a room across the workspace's shared projects: the first message makes one chat in each.
 * A project no workspace shares has no room on the Hub, so it stays out and the page says so.
 */
export function NewSharedRoom({
  environmentId,
  status,
  places,
  left,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  /** The shared projects, as far as a room needs them. */
  readonly places: ReadonlyArray<Pick<RoomPlace, "workspace" | "project">>;
  /** The names of the projects that stay out. */
  readonly left: ReadonlyArray<string>;
}) {
  const navigate = useNavigate();
  const createTask = useAtomCommand(serverEnvironment.peerHubCreateTask, { reportFailure: false });
  const group = useRef(randomUUID());
  // A post that fails keeps its chats, so sending again adds no second set.
  const created = useRef<ReadonlyArray<RoomPlace> | null>(null);
  const first = places[0];
  const state = first === undefined ? undefined : stateOf(status, { ...first, task: "" });
  const me = status.email;
  if (first === undefined || state === undefined || me === null) {
    return (
      <p className="px-4 py-5 text-sm text-muted-foreground">
        A room needs a project shared with your team.
      </p>
    );
  }
  const nameOf = (email: string) => personName(state, email);
  const prepare = async (text: string) => {
    if (created.current !== null) return created.current;
    const made = await Promise.all(
      places.map(async ({ workspace, project }) => {
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
        return { workspace, project, task };
      }),
    );
    created.current = made;
    return made;
  };
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4">
      <h1 className="text-center text-2xl font-medium text-foreground">
        What should we build across these projects?
      </h1>
      <RoomComposer
        environmentId={environmentId}
        place={{ ...first, task: "new-shared-room" }}
        targets={targetsFor(state.project, { id: "", createdBy: me }, [], me, {
          nameOf,
          chat: true,
        })}
        people={peopleOf(state.project.members, me, nameOf)}
        personalHarnesses={state.project.capacity.personalHarnesses}
        line={null}
        paths={null}
        chat
        emptyDraft={OWN_AGENT}
        prepare={prepare}
        placeholder="Write to your agents or anyone on the projects. @ names a person."
        onDrafting={NOTHING}
        onSent={() => void navigate({ to: "/together/$group", params: { group: group.current } })}
      />
      {left.length === 0 ? null : (
        <p className="text-center text-xs text-muted-foreground">
          {left.join(", ")} only on this computer, so it stays out of the room.
        </p>
      )}
    </div>
  );
}
