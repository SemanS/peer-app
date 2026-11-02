import { useAtomValue } from "@effect/atom-react";
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import {
  anchorText,
  namesInWords,
  targetsFor,
  type RoomPlace,
} from "@t3tools/client-runtime/peer/rooms";
import type {
  EnvironmentId,
  PeerHubStatus,
  PeerProjectState,
  PeerRoomAnchor,
  PeerRoomDiff,
  PeerRoomMessage,
  PeerRun,
  PeerTask,
} from "@t3tools/contracts";

import { harnessName } from "@t3tools/client-runtime/peer/work";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { type DragEvent, useEffect, useEffectEvent, useRef, useState } from "react";

import { cn } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { AgentTrustQuestion } from "../herdr/AgentTrustQuestion";
import { FILE_TREE_PATHS_DRAG_TYPE, fileTreePathsOf } from "../../files/fileTreeDragMention";
import { PeerPageHeader } from "../PeerPageHeader";
import type { ProjectSet } from "../projectSets.logic";
import * as Schema from "effect/Schema";
import { useLocalStorage } from "../../../hooks/useLocalStorage";
import { RoomSidePanel, RoomProjectColumn as ProjectColumn } from "./RoomPanels";
import { RoomWorktreePicker } from "./RoomWorktreePicker";
import { runThreadWorking, runsRevision } from "../task/runs.logic";
import { useTaskRuns } from "../task/useTaskRuns";
import { useWorkData } from "../useWorkData";
import type { WorkOpen, WorkTaskNode } from "../workTree.logic";
import {
  chatIsYours,
  findTask,
  followedRun,
  lastAgentReply,
  peopleOf,
  ROOM_PAGE,
} from "./room.logic";
import { RoomAgentDiff, type RoomAgentChangesProps } from "./RoomAgentDiff";
import { RoomComposer, type DraftLine, type DraftPaths } from "./RoomComposer";
import { roomMessageId, RoomConversation } from "./RoomConversation";
import { RoomDiff, type DiffFocus } from "./RoomDiff";
import { RoomAgents } from "./RoomAgents";
import { RoomFiles } from "./RoomFiles";
import { RoomJujutsu } from "./RoomJujutsu";
import { RoomProjects } from "./RoomProjects";
import { watchable } from "./roomDiff.logic";
import {
  roomChips,
  runProjectNames,
  scopeOfPlace,
  sharedRoomOf,
  sharedTimeline,
  type SharedRoomMember,
} from "./sharedRoom.logic";
import { useRoom, useRoomDiff, useRoomMoves, useRoomRead } from "./useRoom";

const NO_CHATS: ReadonlyArray<RoomChat> = [];
const NO_CLOSED: ReadonlyArray<ClosedChat> = [];
const NO_RUN_RECORDS: ReadonlyArray<PeerRun> = [];

const SIDE_LABEL = {
  diff: "Diff",
  files: "Files",
  jujutsu: "Jujutsu",
  agents: "Agents",
  agent: "Agent",
} as const;
type RoomSide = keyof typeof SIDE_LABEL;
const isRoomSide = (value: unknown): value is RoomSide =>
  typeof value === "string" && Object.hasOwn(SIDE_LABEL, value);
/** What a room shows of each project in turn, rather than of the room as a whole. */
const isProjectSide = (side: RoomSide) => side === "diff" || side === "files" || side === "jujutsu";

const ALL_PROJECTS_SHOWN = "all";

const isOnJujutsu = (state: PeerProjectState) =>
  state.repositories.some((repository) => repository.vcs === "jj");

/** Why a room's agent does not work in a project, as the `In` row says it. */
const awayOf = (state: PeerProjectState) =>
  state.repositories.some((repository) => repository.state === "ready")
    ? undefined
    : "This computer has no checkout of it.";

/** Another project's chat of a room across projects. */
export interface RoomChat {
  readonly place: RoomPlace;
  readonly project: string;
  readonly state: PeerProjectState;
  readonly hubTask: PeerTask;
  readonly task: WorkTaskNode;
}

/** A chat of the room that closed: only its words stay. */
export type ClosedChat = Pick<SharedRoomMember, "place" | "project">;

/** What makes a room one across projects: its other chats, and the workspace that groups them. */
export interface RoomAcross {
  readonly others: ReadonlyArray<RoomChat>;
  readonly closed: ReadonlyArray<ClosedChat>;
  readonly set: ProjectSet | undefined;
}

/** What one project's chat gives the room that lives in another. */
interface ChatRead {
  readonly messages: ReadonlyArray<PeerRoomMessage>;
  readonly runs: ReadonlyArray<PeerRun>;
  readonly seq: number;
  readonly refresh: () => void;
  readonly now: number;
  readonly error: string | null;
}

/**
 * A task's room: its conversation between people and their agents, with the task's diff, the
 * project's files, its Jujutsu changes or its agents beside it from `lg` and behind a switch below. Peer's own page rather than a chat widget: the conversation
 * runs in one column, and the composer stays at the bottom as the review's bar does. A chat of a
 * room across projects opens as that room.
 */
export function RoomView({
  workspace,
  project,
  task,
}: {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}) {
  const { environmentId, status, tree, actions } = useWorkData();
  const found = findTask(tree, { workspace, project, task });
  const state = status?.workspaces
    .find((candidate) => candidate.slug === workspace)
    ?.projects.find((candidate) => candidate.project.id === project);
  const hubTask = state?.work.tasks.find((candidate) => candidate.id === task);
  const projectName = found?.project.name ?? state?.project.name ?? project;
  const isChat = hubTask?.chat === true;
  const navigate = useNavigate();
  const updateTask = useAtomCommand(serverEnvironment.peerHubUpdateTask, { reportFailure: false });
  const closeChat = async () => {
    if (environmentId === null) return;
    const input = { workspace, projectId: project, taskId: task, status: "done" as const };
    const result = await updateTask({ environmentId, input });
    if (result._tag === "Success") await navigate({ to: "/" });
  };
  const group = hubTask?.group;
  if (group !== undefined && status !== null && sharedRoomOf(status, group) !== null) {
    return <Navigate to="/together/$group" params={{ group }} replace />;
  }
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={{ name: projectName, colorKey: `${workspace}/${project}` }}
          task={hubTask === undefined ? undefined : { key: hubTask.key, title: hubTask.title }}
          page={isChat ? "Chat" : "Room"}
          {...(isChat
            ? {
                actions: (
                  <Button size="sm" variant="ghost" onClick={() => void closeChat()}>
                    Close chat
                  </Button>
                ),
              }
            : {})}
        />
        {status === null || environmentId === null ? (
          <p role="status" className="px-6 py-6 text-sm text-muted-foreground">
            Connecting…
          </p>
        ) : state === undefined || hubTask === undefined || found === undefined ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            This task is no longer on the project.
          </p>
        ) : status.email === null ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            Sign in to the Hub to read this room.
          </p>
        ) : (
          <RoomBody
            key={`${environmentId}:${workspace}:${project}:${task}`}
            environmentId={environmentId}
            status={status}
            me={status.email}
            place={{ workspace, project, task }}
            projectState={state}
            hubTask={hubTask}
            taskNode={found.task}
            onOpen={actions.open}
          />
        )}
      </div>
    </SidebarInset>
  );
}

/**
 * The room's conversation and what stands beside it. `place` is the chat it lives in; a room across
 * projects adds `across`, and each of its projects then has a column of its own beside the
 * conversation, while the agent's thread stays one, as it is one agent.
 */
export function RoomBody({
  environmentId,
  status,
  me,
  place,
  projectState,
  hubTask,
  taskNode,
  onOpen,
  across,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly me: string;
  readonly place: RoomPlace;
  readonly projectState: PeerProjectState;
  readonly hubTask: PeerTask;
  readonly taskNode: WorkTaskNode;
  readonly onOpen: (open: WorkOpen) => void;
  readonly across?: RoomAcross;
}) {
  const nameOf = (email: string) => personName(projectState, email);
  const revision = runsRevision(taskNode.runs, taskNode.threads);
  const runs = useTaskRuns({
    environmentId,
    workspace: place.workspace,
    projectId: place.project,
    taskId: place.task,
    revision,
  });
  const read = useRoom({ environmentId, status, place, revision });
  const diff = useRoomDiff({ environmentId, place, revision });
  const others = across?.others ?? NO_CHATS;
  const closed = across?.closed ?? NO_CLOSED;
  const [reads, setReads] = useState<ReadonlyMap<string, ChatRead>>(new Map());
  const otherReads = [...others, ...closed].flatMap(
    (other) => reads.get(other.place.project) ?? [],
  );
  const moves = useRoomMoves(environmentId, () => {
    read.refresh();
    for (const other of otherReads) other.refresh();
  });
  // Below `lg` one pane shows at a time; both stay mounted so neither loses its place.
  const [sideCollapsed, setSideCollapsed] = useLocalStorage(
    `peer.room.side-collapsed.${environmentId}`,
    false,
    Schema.Boolean,
  );
  const [pane, setPane] = useState<"conversation" | "side">("conversation");
  const [side, setSide] = useState<RoomSide>("diff");
  // The tree lists folders from the disk and Jujutsu subscribes to the project's changes, so a room
  // that never opens them costs neither.
  const [opened, setOpened] = useState<ReadonlySet<RoomSide>>(new Set(["diff"]));
  const [run, setRun] = useState<{
    readonly id: string;
    readonly agent: string | undefined;
    readonly seq: number;
    /** The moment its thread opens at; absent while the agent works, to follow it. */
    readonly until: string | undefined;
    /** The chat its message is in, whose run it is. */
    readonly place: RoomPlace;
  } | null>(null);
  const [focus, setFocus] = useState<(DiffFocus & { readonly project: string }) | null>(null);
  const [line, setLine] = useState<DraftLine | null>(null);
  const [paths, setPaths] = useState<DraftPaths | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [dropping, setDropping] = useState(false);
  /** The one project asked for beside the conversation; a chat that closed shows them all again. */
  const [asked, setAsked] = useState<string | null>(null);
  const shown =
    asked === place.project || others.some((other) => other.place.project === asked) ? asked : null;
  // A dragged path says nothing of its project, and it reads as another project's only with it.
  const draggedFrom = useRef<string | null>(null);
  const canPost = useAtomValue(serverEnvironment.peerRooms.post.permissionAtom(environmentId));
  const canMove = useAtomValue(serverEnvironment.peerRooms.pass.permissionAtom(environmentId));

  const chips = roomChips(
    [
      { place, project: projectState.project.name, away: awayOf(projectState) },
      ...others.map((other) => ({ ...other, away: awayOf(other.state) })),
      ...closed.map((chat) => ({ ...chat, away: "Its chat is closed." })),
    ],
    read.room?.folders ?? [],
    across?.set,
  );
  const names = chips.filter((chip) => chip.marked).map((chip) => chip.name);
  const people = peopleOf(projectState.project.members, me, nameOf);
  const targets = targetsFor(projectState.project, hubTask, runs.runs, me, {
    ...(read.room?.hasCheckout === undefined ? {} : { hasCheckout: read.room.hasCheckout }),
    nameOf,
    chat: hubTask.chat === true,
    ...(across === undefined ? {} : { across: names }),
  });

  const showSide = (next: RoomSide) => {
    setSideCollapsed(false);
    setSide(next);
    setPane("side");
    setOpened((current) => new Set([...current, next]));
  };

  const addPaths = (added: ReadonlyArray<string>) => {
    setPaths((current) => ({ paths: added, ask: (current?.ask ?? 0) + 1 }));
    setPane("conversation");
  };

  const takesPaths = (event: DragEvent) =>
    canPost && event.dataTransfer.types.includes(FILE_TREE_PATHS_DRAG_TYPE);

  const threads = [...taskNode.threads, ...others.flatMap((other) => other.task.threads)];
  const threadWorking = (candidate: PeerRun) => runThreadWorking(candidate, threads);
  const allRuns = [...runs.runs, ...otherReads.flatMap((other) => other.runs)];
  const onJujutsu = isOnJujutsu(projectState);
  const runWorking = (candidate: PeerRun) =>
    threadWorking(candidate) ?? candidate.sessions.some((session) => session.to === undefined);
  const lastReply = lastAgentReply(read.messages);
  const followed =
    run === null ? followedRun(allRuns, runWorking, lastReply?.author.run) : undefined;
  // Nothing opened: the tab follows the agent, from its first step and not from its first message.
  const agentRun =
    followed === undefined
      ? run
      : {
          id: followed.id,
          agent: followed.agent,
          seq: 0,
          until: undefined,
          place: { workspace: followed.workspace, project: followed.project, task: followed.task },
        };
  const agentLabel = agentRun === null ? null : (harnessName(agentRun.agent) ?? "Agent");
  const commentOn = (anchor: PeerRoomAnchor) => {
    if (canPost) setLine({ anchor, ask: (line?.ask ?? 0) + 1 });
    setPane("conversation");
  };

  const openMessage = (seq: number, project?: string) => {
    setPane("conversation");
    requestAnimationFrame(() =>
      document.getElementById(roomMessageId(seq, project))?.scrollIntoView({ block: "center" }),
    );
  };

  const timeline =
    across === undefined
      ? undefined
      : sharedTimeline(
          [
            {
              member: { place, project: projectState.project.name },
              messages: read.messages,
            },
            ...[...others, ...closed].map((other) => ({
              member: other,
              messages: reads.get(other.place.project)?.messages ?? [],
            })),
          ],
          place,
        );

  const picked =
    run ??
    (lastReply?.author.run === undefined
      ? null
      : { id: lastReply.author.run, agent: lastReply.author.agent, seq: lastReply.seq });
  const pickedRun = allRuns.find((candidate) => candidate.id === picked?.id);
  const jujutsuAgent =
    picked === null
      ? null
      : {
          id: picked.id,
          seq: picked.seq,
          label: harnessName(pickedRun?.agent ?? picked.agent) ?? "Agent",
          working: pickedRun !== undefined && runWorking(pickedRun),
        };

  const homeChanges = {
    taskName: hubTask.key ?? hubTask.id,
    revision,
    messages: read.messages,
    drafting,
    me,
    nameOf,
    watch: watchable(taskNode.threads),
    onWatch: onOpen,
    onComment: commentOn,
    onAddPaths: canPost ? addPaths : undefined,
    onOpenMessage: openMessage,
  };
  const shownOther = others.find((other) => other.place.project === shown);
  // A project's changes are read where they are; the thread stays the run's own.
  const agentChanges =
    shownOther === undefined
      ? { ...homeChanges, place, jujutsu: onJujutsu }
      : {
          ...homeChanges,
          ...otherActions(shownOther.project, addPaths, canPost),
          onOpenMessage: (seq: number) => openMessage(seq, shownOther.project),
          taskName: shownOther.hubTask.key ?? shownOther.hubTask.id,
          messages: reads.get(shownOther.place.project)?.messages ?? [],
          watch: watchable(shownOther.task.threads),
          drafting: false,
          nameOf: (email: string) => personName(shownOther.state, email),
          place: shownOther.place,
          jujutsu: isOnJujutsu(shownOther.state),
        };

  const homePanes = (
    <RoomProjectPanes
      environmentId={environmentId}
      status={status}
      side={side}
      opened={opened}
      picked={run === null ? "" : `${run.id}:${run.seq}`}
      agent={jujutsuAgent}
      place={place}
      projectState={projectState}
      task={taskNode}
      diff={diff}
      focus={focus?.project === place.project ? focus : null}
      changes={homeChanges}
    />
  );
  const projectChoice =
    across === undefined || side === "agents" ? null : (
      <ToggleGroup
        aria-label="Project"
        value={[shown ?? (side === "agent" ? place.project : ALL_PROJECTS_SHOWN)]}
        onValueChange={(value) => {
          const next = value[0];
          if (next !== undefined) setAsked(next === ALL_PROJECTS_SHOWN ? null : next);
        }}
      >
        {side === "agent" ? null : <Toggle value={ALL_PROJECTS_SHOWN}>All</Toggle>}
        <Toggle value={place.project}>{projectState.project.name}</Toggle>
        {others.map((other) => (
          <Toggle key={other.place.project} value={other.place.project}>
            {other.project}
          </Toggle>
        ))}
      </ToggleGroup>
    );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border/60 px-4 py-2 lg:hidden">
        <ToggleGroup
          aria-label="Show"
          value={[pane === "conversation" ? "conversation" : side]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "conversation") setPane(next);
            if (isRoomSide(next)) showSide(next);
          }}
        >
          <Toggle value="conversation">Conversation</Toggle>
          <Toggle value="diff">Diff</Toggle>
          <Toggle value="files">Files</Toggle>
          <Toggle value="jujutsu">Jujutsu</Toggle>
          <Toggle value="agents">Agents</Toggle>
          {agentLabel === null ? null : <Toggle value="agent">{agentLabel}</Toggle>}
        </ToggleGroup>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <section
          aria-label="Conversation"
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col lg:flex",
            pane === "conversation" ? "flex" : "hidden",
            dropping && "ring-2 ring-ring ring-inset",
          )}
          onDragOver={(event) => {
            if (!takesPaths(event)) return;
            event.preventDefault();
            // The tree limits its drags to "move"; any other effect cancels the drop.
            event.dataTransfer.dropEffect = "move";
            setDropping(true);
          }}
          onDragLeave={(event) => {
            if (event.relatedTarget instanceof Node) {
              if (event.currentTarget.contains(event.relatedTarget)) return;
            }
            setDropping(false);
          }}
          onDrop={(event) => {
            if (!takesPaths(event)) return;
            event.preventDefault();
            setDropping(false);
            const dropped = fileTreePathsOf(event.dataTransfer.getData(FILE_TREE_PATHS_DRAG_TYPE));
            const from = draggedFrom.current;
            addPaths(from === null ? dropped : dropped.map((path) => `${from}/${path}`));
          }}
        >
          <RoomConversation
            place={place}
            messages={timeline?.messages ?? read.messages}
            total={otherReads.reduce((sum, other) => sum + other.seq, read.room?.seq ?? 0)}
            me={me}
            nameOf={nameOf}
            head={diff.diff?.state === "here" ? diff.diff.head : undefined}
            canAct={canMove}
            moves={moves}
            error={read.error ?? otherReads.find((other) => other.error !== null)?.error ?? null}
            loading={read.room === null}
            now={Math.max(read.now, ...otherReads.map((other) => other.now))}
            runs={allRuns}
            jujutsu={onJujutsu}
            threadWorking={threadWorking}
            selected={run === null ? null : { run: run.id, seq: run.seq }}
            onOpenRun={(message, id, live) => {
              const agent =
                allRuns.find((candidate) => candidate.id === id)?.agent ?? message.author.agent;
              setRun({
                id,
                agent,
                seq: message.seq,
                until: live ? undefined : message.at,
                place: timeline?.rows.get(message)?.place ?? place,
              });
              // On Jujutsu a message opens the state of the work at that moment.
              showSide(onJujutsu ? "jujutsu" : "agent");
            }}
            onOpenAnchor={(anchor, message) => {
              const project = timeline?.rows.get(message)?.place.project ?? place.project;
              showSide("diff");
              setFocus({ anchor, ask: (focus?.ask ?? 0) + 1, project });
              if (shown !== null) setAsked(project);
            }}
            {...(timeline === undefined
              ? {}
              : { shared: (message: PeerRoomMessage) => timeline.rows.get(message) })}
            acrossOf={(id) => {
              const projects = runProjectNames(
                projectState.project.name,
                read.room?.runProjects?.[id],
                others,
              );
              return projects.length === 0 ? undefined : namesInWords(projects);
            }}
          />
          {status.agents.list
            .filter(
              (agent) =>
                agent.trust === true &&
                agent.task === place.task &&
                agent.projectId === place.project &&
                agent.workspace === place.workspace,
            )
            .map((agent) => (
              <div key={agent.id} className="border-t border-border p-3">
                <AgentTrustQuestion environmentId={environmentId} agent={agent} />
              </div>
            ))}
          {canPost ? (
            <RoomComposer
              environmentId={environmentId}
              place={place}
              targets={targets}
              people={people}
              line={line}
              paths={paths}
              onDrafting={setDrafting}
              onSent={() => read.refresh()}
              toOwnAgent={chatIsYours(hubTask, runs.runs, me)}
              {...(across === undefined
                ? {}
                : { across: names, scope: <RoomProjects projects={chips} /> })}
            />
          ) : (
            <div className="flex shrink-0 flex-col gap-2 border-t border-border px-4 py-3 sm:px-6">
              {across === undefined ? null : <RoomProjects projects={chips} />}
              <p className="text-sm text-muted-foreground">
                This connection can read the room but not write to it.
              </p>
            </div>
          )}
        </section>
        <RoomSidePanel
          storageKey={`peer.room.side-width.${environmentId}`}
          label={side === "agent" ? (agentLabel ?? SIDE_LABEL.agent) : SIDE_LABEL[side]}
          mobileShown={pane === "side"}
          collapsed={sideCollapsed}
          onCollapse={setSideCollapsed}
        >
          <div
            className={cn(
              "shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2 lg:flex lg:pe-10",
              projectChoice === null ? "hidden" : "flex",
            )}
          >
            <div className="hidden lg:block">
              <ToggleGroup
                aria-label="Show beside the conversation"
                value={[side]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (isRoomSide(next)) showSide(next);
                }}
              >
                <Toggle value="diff">Diff</Toggle>
                <Toggle value="files">Files</Toggle>
                <Toggle value="jujutsu">Jujutsu</Toggle>
                <Toggle value="agents">Agents</Toggle>
                {agentLabel === null ? null : <Toggle value="agent">{agentLabel}</Toggle>}
              </ToggleGroup>
            </div>
            {projectChoice}
          </div>
          <div
            className={cn(
              "min-h-0 min-w-0 flex-1",
              isProjectSide(side) ? "flex" : "hidden",
              across !== undefined && "overflow-x-auto",
            )}
          >
            {across === undefined ? (
              homePanes
            ) : (
              <>
                <ProjectColumn
                  name={projectState.project.name}
                  colorKey={scopeOfPlace(place)}
                  storageKey={`peer.room.column.${environmentId}:${scopeOfPlace(place)}`}
                  shown={shown === null || shown === place.project}
                  onDrag={() => {
                    draggedFrom.current = null;
                  }}
                >
                  {homePanes}
                </ProjectColumn>
                {others.map((other) => (
                  <OtherChat
                    key={other.place.project}
                    environmentId={environmentId}
                    status={status}
                    me={me}
                    chat={other}
                    side={side}
                    opened={opened}
                    picked={run === null ? "" : `${run.id}:${run.seq}`}
                    agent={jujutsuAgent}
                    focus={focus?.project === other.place.project ? focus : null}
                    shown={shown === null || shown === other.place.project}
                    canPost={canPost}
                    onRead={(chat) =>
                      setReads((current) => new Map(current).set(other.place.project, chat))
                    }
                    onOpen={onOpen}
                    onAddPaths={addPaths}
                    onOpenMessage={openMessage}
                    onDrag={() => {
                      draggedFrom.current = other.project;
                    }}
                  />
                ))}
                {closed.map((chat) => (
                  <ClosedChatRead
                    key={chat.place.project}
                    environmentId={environmentId}
                    status={status}
                    place={chat.place}
                    onRead={(read) =>
                      setReads((current) => new Map(current).set(chat.place.project, read))
                    }
                  />
                ))}
              </>
            )}
          </div>
          {agentRun === null ? null : (
            <div
              className={cn(
                "min-h-0 min-w-0 flex-1 flex-col",
                side === "agent" ? "flex" : "hidden",
              )}
              onDragStartCapture={() => {
                draggedFrom.current = shownOther?.project ?? null;
              }}
            >
              <RoomAgentDiff
                {...agentChanges}
                key={`${agentRun.id}:${agentRun.seq}`}
                environmentId={environmentId}
                threadAt={agentRun.place}
                run={agentRun.id}
                until={agentRun.until}
                working={
                  side === "agent" &&
                  allRuns.some((candidate) => candidate.id === agentRun.id && runWorking(candidate))
                }
              />
            </div>
          )}
          <div
            className={cn("min-h-0 min-w-0 flex-1 flex-col", side === "agents" ? "flex" : "hidden")}
          >
            <RoomAgents
              environmentId={environmentId}
              status={status}
              projectState={projectState}
              runs={runs.runs}
              threads={taskNode.threads}
              me={me}
              now={read.now}
              nameOf={nameOf}
              onOpen={onOpen}
              place={place}
              {...(across === undefined
                ? {}
                : { across: others.map((other) => scopeOfPlace(other.place)) })}
            />
          </div>
        </RoomSidePanel>
      </div>
    </div>
  );
}

/** What adding to the draft does from another project: a bare path there would name this one's. */
const otherActions = (
  project: string,
  addPaths: (paths: ReadonlyArray<string>) => void,
  canPost: boolean,
) => {
  const add = (paths: ReadonlyArray<string>) => addPaths(paths.map((path) => `${project}/${path}`));
  return {
    onComment: (anchor: PeerRoomAnchor) => add([anchorText(anchor)]),
    onAddPaths: canPost ? add : undefined,
  };
};

/** A closed chat of the room: nothing runs there, so its words are all there is to read. */
function ClosedChatRead({
  environmentId,
  status,
  place,
  onRead,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly place: RoomPlace;
  readonly onRead: (read: ChatRead) => void;
}) {
  const read = useRoomRead({ environmentId, status, place, limit: ROOM_PAGE });
  const report = useEffectEvent(onRead);
  const seq = read.room?.seq ?? 0;
  useEffect(() => {
    report({
      messages: read.messages,
      runs: NO_RUN_RECORDS,
      seq,
      refresh: read.refresh,
      now: read.now,
      error: read.error,
    });
  }, [read.error, read.messages, read.now, read.refresh, seq]);
  return null;
}

/** One project's chat of a room that lives in another: read here, its messages handed up. */
function OtherChat({
  environmentId,
  status,
  me,
  chat,
  side,
  opened,
  picked,
  agent,
  focus,
  shown,
  canPost,
  onRead,
  onOpen,
  onAddPaths,
  onOpenMessage,
  onDrag,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly me: string;
  readonly chat: RoomChat;
  readonly side: RoomSide;
  readonly opened: ReadonlySet<RoomSide>;
  readonly picked: string;
  readonly agent: JujutsuAgentRef | null;
  readonly focus: DiffFocus | null;
  readonly shown: boolean;
  readonly canPost: boolean;
  readonly onRead: (read: ChatRead) => void;
  readonly onOpen: (open: WorkOpen) => void;
  readonly onAddPaths: (paths: ReadonlyArray<string>) => void;
  readonly onOpenMessage: (seq: number, project?: string) => void;
  readonly onDrag: () => void;
}) {
  const { place, state, task, hubTask, project } = chat;
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
  const seq = read.room?.seq ?? 0;
  useEffect(() => {
    report({
      messages: read.messages,
      runs: runs.runs,
      seq,
      refresh: read.refresh,
      now: read.now,
      error: read.error,
    });
  }, [read.error, read.messages, read.now, read.refresh, runs.runs, seq]);
  return (
    <ProjectColumn
      name={project}
      colorKey={scopeOfPlace(place)}
      storageKey={`peer.room.column.${environmentId}:${scopeOfPlace(place)}`}
      shown={shown}
      onDrag={onDrag}
    >
      <RoomProjectPanes
        environmentId={environmentId}
        status={status}
        side={side}
        opened={opened}
        picked={picked}
        agent={agent}
        place={place}
        projectState={state}
        task={task}
        diff={diff}
        focus={focus}
        changes={{
          taskName: hubTask.key ?? hubTask.id,
          revision,
          messages: read.messages,
          drafting: false,
          me,
          nameOf: (email) => personName(state, email),
          watch: watchable(task.threads),
          onWatch: onOpen,
          ...otherActions(project, onAddPaths, canPost),
          onOpenMessage: (seen) => onOpenMessage(seen, project),
        }}
      />
    </ProjectColumn>
  );
}

/** The agent whose work a project's Jujutsu tab shows. */
interface JujutsuAgentRef {
  readonly id: string;
  readonly seq: number;
  readonly label: string;
  readonly working: boolean;
}

/** What one project shows beside the conversation: its diff, its files, its Jujutsu changes. */
function RoomProjectPanes({
  environmentId,
  status,
  side,
  opened,
  picked,
  agent,
  place,
  projectState,
  task,
  diff,
  focus,
  changes,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly side: RoomSide;
  readonly opened: ReadonlySet<RoomSide>;
  /** The message picked in the conversation, so Jujutsu starts over on another. */
  readonly picked: string;
  readonly agent: JujutsuAgentRef | null;
  readonly place: RoomPlace;
  readonly projectState: PeerProjectState;
  readonly task: WorkTaskNode;
  readonly diff: {
    readonly diff: PeerRoomDiff | null;
    readonly error: string | null;
    readonly refresh: () => void;
  };
  readonly focus: DiffFocus | null;
  readonly changes: Omit<RoomAgentChangesProps, "environmentId" | "place" | "run" | "jujutsu">;
}) {
  const { onAddPaths } = changes;
  const [worktree, setWorktree] = useState<string | undefined>(undefined);
  const [seenFocus, setSeenFocus] = useState(focus?.ask);
  if (focus?.ask !== seenFocus) {
    setSeenFocus(focus?.ask);
    setWorktree(undefined);
  }
  const selected = useRoomDiff({
    environmentId,
    place,
    revision: changes.revision,
    worktree,
    enabled: worktree !== undefined,
  });
  const inspected = worktree === undefined ? diff : selected;
  return (
    <>
      {side === "diff" || side === "files" ? (
        <RoomWorktreePicker
          projectName={projectState.project.name}
          diff={inspected.diff ?? diff.diff}
          selected={worktree}
          onSelect={setWorktree}
          onRefresh={inspected.refresh}
        />
      ) : null}
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", side === "diff" ? "flex" : "hidden")}>
        <RoomDiff
          diff={inspected.diff}
          error={inspected.error}
          onRefresh={inspected.refresh}
          messages={changes.messages}
          drafting={changes.drafting}
          focus={focus}
          me={changes.me}
          nameOf={changes.nameOf}
          watch={changes.watch}
          onWatch={changes.onWatch}
          onComment={changes.onComment}
          onAddPaths={onAddPaths}
          onOpenMessage={changes.onOpenMessage}
        />
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", side === "files" ? "flex" : "hidden")}>
        {opened.has("files") ? (
          <RoomFiles
            environmentId={environmentId}
            diff={inspected.diff}
            error={inspected.error}
            projectName={projectState.project.name}
            canPost={onAddPaths !== undefined}
            revision={changes.revision}
            onRefresh={inspected.refresh}
            onAdd={(path) => onAddPaths?.([path])}
          />
        ) : null}
      </div>
      <div
        className={cn("min-h-0 min-w-0 flex-1 flex-col", side === "jujutsu" ? "flex" : "hidden")}
      >
        {opened.has("jujutsu") ? (
          <RoomJujutsu
            key={picked}
            agent={agent === null ? null : { ...changes, ...agent, run: agent.id }}
            environmentId={environmentId}
            status={status}
            place={place}
            projectState={projectState}
            task={task}
          />
        ) : null}
      </div>
    </>
  );
}
