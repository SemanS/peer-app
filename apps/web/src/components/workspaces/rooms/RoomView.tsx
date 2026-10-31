import { useAtomValue } from "@effect/atom-react";
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import { targetsFor, type RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type {
  EnvironmentId,
  PeerHubStatus,
  PeerProjectState,
  PeerRoomAnchor,
  PeerRun,
  PeerTask,
} from "@t3tools/contracts";

import { harnessName } from "@t3tools/client-runtime/peer/work";
import { type DragEvent, useState } from "react";

import { cn } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { SidebarInset } from "../../ui/sidebar";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { FILE_TREE_PATHS_DRAG_TYPE, fileTreePathsOf } from "../../files/fileTreeDragMention";
import { PeerPageHeader } from "../PeerPageHeader";
import { findTask } from "../task/task.logic";
import { runThreadKeys, runsRevision } from "../task/runs.logic";
import { useTaskRuns } from "../task/TaskRuns";
import { useWorkData } from "../useWorkData";
import type { WorkOpen, WorkTaskNode } from "../workTree.logic";
import { lastAgentReply, peopleOf, reachRows } from "./room.logic";
import { RoomAgentDiff } from "./RoomAgentDiff";
import { RoomComposer, type DraftLine, type DraftPaths } from "./RoomComposer";
import { roomMessageId, RoomConversation } from "./RoomConversation";
import { RoomDiff, type DiffFocus } from "./RoomDiff";
import { RoomFiles } from "./RoomFiles";
import { RoomJujutsu } from "./RoomJujutsu";
import { RoomReach } from "./RoomReach";
import { watchable } from "./roomDiff.logic";
import { useRoom, useRoomDiff, useRoomMoves } from "./useRoom";

const NO_RUNS: ReadonlyArray<string> = [];

const SIDE_LABEL = { diff: "Diff", files: "Files", jujutsu: "Jujutsu", agent: "Agent" } as const;
type RoomSide = keyof typeof SIDE_LABEL;
const isRoomSide = (value: unknown): value is RoomSide =>
  typeof value === "string" && Object.hasOwn(SIDE_LABEL, value);

/**
 * A task's room: its conversation between people and their agents, with the task's diff, the
 * project's files or its Jujutsu changes beside it from `lg` and behind a switch below. Peer's own page rather than a chat widget: the conversation
 * runs in one column, and the composer stays at the bottom as the review's bar does.
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
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={{ name: projectName, colorKey: `${workspace}/${project}` }}
          task={hubTask === undefined ? undefined : { key: hubTask.key, title: hubTask.title }}
          page="Room"
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

function RoomBody({
  environmentId,
  status,
  me,
  place,
  projectState,
  hubTask,
  taskNode,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly me: string;
  readonly place: RoomPlace;
  readonly projectState: PeerProjectState;
  readonly hubTask: PeerTask;
  readonly taskNode: WorkTaskNode;
  readonly onOpen: (open: WorkOpen) => void;
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
  const moves = useRoomMoves(environmentId, read.refresh);
  // Below `lg` one pane shows at a time; both stay mounted so neither loses its place.
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
  } | null>(null);
  const [focus, setFocus] = useState<DiffFocus | null>(null);
  const [line, setLine] = useState<DraftLine | null>(null);
  const [paths, setPaths] = useState<DraftPaths | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [dropping, setDropping] = useState(false);
  const canPost = useAtomValue(serverEnvironment.peerRooms.post.permissionAtom(environmentId));
  const canMove = useAtomValue(serverEnvironment.peerRooms.pass.permissionAtom(environmentId));

  const people = peopleOf(projectState.project.members, me, nameOf);
  const targets = targetsFor(projectState.project, hubTask, runs.runs, me, {
    ...(read.room?.hasCheckout === undefined ? {} : { hasCheckout: read.room.hasCheckout }),
    reaches: read.room?.reaches ?? [],
    nameOf,
  });

  const showSide = (next: RoomSide) => {
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

  const threadWorking = (candidate: PeerRun) => {
    const keys = runThreadKeys(candidate);
    const threads = taskNode.threads.filter((thread) => keys.includes(thread.key));
    return threads.length === 0 ? undefined : threads.some((thread) => thread.status === "working");
  };
  const onJujutsu = projectState.repositories.some((repository) => repository.vcs === "jj");
  const agentLabel = run === null ? null : (harnessName(run.agent) ?? "Agent");
  const commentOn = (anchor: PeerRoomAnchor) => {
    if (canPost) setLine({ anchor, ask: (line?.ask ?? 0) + 1 });
    setPane("conversation");
  };

  const openMessage = (seq: number) => {
    setPane("conversation");
    requestAnimationFrame(() =>
      document.getElementById(roomMessageId(seq))?.scrollIntoView({ block: "center" }),
    );
  };

  const lastReply = lastAgentReply(read.messages);
  const shown =
    run ??
    (lastReply?.author.run === undefined
      ? null
      : { id: lastReply.author.run, agent: lastReply.author.agent, seq: lastReply.seq });
  const shownRun = runs.runs.find((candidate) => candidate.id === shown?.id);
  const jujutsuAgent =
    shown === null
      ? null
      : {
          id: shown.id,
          seq: shown.seq,
          label: harnessName(shownRun?.agent ?? shown.agent) ?? "Agent",
          working:
            shownRun !== undefined &&
            (threadWorking(shownRun) ??
              shownRun.sessions.some((session) => session.to === undefined)),
        };

  const agentChanges = {
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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <RoomReach
        environmentId={environmentId}
        place={place}
        rows={reachRows(runs.runs, me, read.room)}
        onChanged={read.refresh}
      />
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
          {agentLabel === null ? null : <Toggle value="agent">{agentLabel}</Toggle>}
        </ToggleGroup>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <section
          aria-label="Conversation"
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col lg:flex lg:max-w-[42rem] lg:border-e lg:border-border",
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
            addPaths(fileTreePathsOf(event.dataTransfer.getData(FILE_TREE_PATHS_DRAG_TYPE)));
          }}
        >
          <RoomConversation
            place={place}
            messages={read.messages}
            total={read.room?.seq ?? 0}
            me={me}
            nameOf={nameOf}
            head={diff.diff?.state === "here" ? diff.diff.head : undefined}
            canAct={canMove}
            moves={moves}
            error={read.error}
            loading={read.room === null}
            now={read.now}
            runs={runs.runs}
            reviewRuns={read.room?.reviewRuns ?? NO_RUNS}
            jujutsu={onJujutsu}
            threadWorking={threadWorking}
            selected={run?.seq ?? null}
            onOpenRun={(message, id, live) => {
              const agent =
                runs.runs.find((candidate) => candidate.id === id)?.agent ?? message.author.agent;
              setRun({
                id,
                agent,
                seq: message.seq,
                until: live ? undefined : message.at,
              });
              // On Jujutsu a message opens the state of the work at that moment.
              showSide(onJujutsu ? "jujutsu" : "agent");
            }}
            onOpenAnchor={(anchor) => {
              showSide("diff");
              setFocus({ anchor, ask: (focus?.ask ?? 0) + 1 });
            }}
          />
          {canPost ? (
            <RoomComposer
              environmentId={environmentId}
              place={place}
              targets={targets}
              people={people}
              personalHarnesses={projectState.project.capacity.personalHarnesses}
              line={line}
              paths={paths}
              onDrafting={setDrafting}
              onSent={read.refresh}
            />
          ) : (
            <p className="shrink-0 border-t border-border px-4 py-3 text-sm text-muted-foreground sm:px-6">
              This connection can read the room but not write to it.
            </p>
          )}
        </section>
        <section
          aria-label={side === "agent" ? (agentLabel ?? SIDE_LABEL.agent) : SIDE_LABEL[side]}
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col lg:flex",
            pane === "side" ? "flex" : "hidden",
          )}
        >
          <div className="hidden shrink-0 border-b border-border/60 px-4 py-2 lg:block">
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
              {agentLabel === null ? null : <Toggle value="agent">{agentLabel}</Toggle>}
            </ToggleGroup>
          </div>
          <div
            className={cn("min-h-0 min-w-0 flex-1 flex-col", side === "diff" ? "flex" : "hidden")}
          >
            <RoomDiff
              diff={diff.diff}
              error={diff.error}
              onRefresh={diff.refresh}
              messages={read.messages}
              drafting={drafting}
              focus={focus}
              me={me}
              nameOf={nameOf}
              watch={watchable(taskNode.threads)}
              onWatch={onOpen}
              onComment={commentOn}
              onAddPaths={canPost ? addPaths : undefined}
              onOpenMessage={openMessage}
            />
          </div>
          {run === null ? null : (
            <div
              className={cn(
                "min-h-0 min-w-0 flex-1 flex-col",
                side === "agent" ? "flex" : "hidden",
              )}
            >
              <RoomAgentDiff
                {...agentChanges}
                key={`${run.id}:${run.seq}`}
                environmentId={environmentId}
                place={place}
                run={run.id}
                until={run.until}
                jujutsu={onJujutsu}
              />
            </div>
          )}
          <div
            className={cn("min-h-0 min-w-0 flex-1 flex-col", side === "files" ? "flex" : "hidden")}
          >
            {opened.has("files") ? (
              <RoomFiles
                environmentId={environmentId}
                diff={diff.diff}
                error={diff.error}
                projectName={projectState.project.name}
                canPost={canPost}
                onRefresh={diff.refresh}
                onAdd={(path) => addPaths([path])}
              />
            ) : null}
          </div>
          <div
            className={cn(
              "min-h-0 min-w-0 flex-1 flex-col",
              side === "jujutsu" ? "flex" : "hidden",
            )}
          >
            {opened.has("jujutsu") ? (
              <RoomJujutsu
                key={run === null ? "" : `${run.id}:${run.seq}`}
                agent={
                  jujutsuAgent === null
                    ? null
                    : {
                        ...agentChanges,
                        ...jujutsuAgent,
                        run: jujutsuAgent.id,
                      }
                }
                environmentId={environmentId}
                status={status}
                place={place}
                projectState={projectState}
                task={taskNode}
              />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
