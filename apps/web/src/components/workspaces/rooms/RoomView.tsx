import { useAtomValue } from "@effect/atom-react";
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import { targetsFor, type RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { EnvironmentId, PeerHubStatus, PeerProjectState, PeerTask } from "@t3tools/contracts";

import { useState } from "react";

import { cn } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { SidebarInset } from "../../ui/sidebar";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { PeerPageHeader } from "../PeerPageHeader";
import { findTask } from "../task/task.logic";
import { runsRevision } from "../task/runs.logic";
import { useTaskRuns } from "../task/TaskRuns";
import { useWorkData } from "../useWorkData";
import type { WorkOpen, WorkTaskNode } from "../workTree.logic";
import { choicesWithMentions, hasOpenRun, peopleOf } from "./room.logic";
import { RoomComposer } from "./RoomComposer";
import { roomMessageId, RoomConversation } from "./RoomConversation";
import { RoomDiff, type DiffFocus } from "./RoomDiff";
import { watchable } from "./roomDiff.logic";
import { useRoom, useRoomDiff, useRoomDraft, useRoomMoves } from "./useRoom";

/**
 * A task's room: its conversation between people and their agents, with the task's diff beside it
 * from `lg` and behind a switch below. Peer's own page rather than a chat widget: the conversation
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
  const diff = useRoomDiff({ environmentId, status, place, revision });
  const moves = useRoomMoves(environmentId, read.refresh);
  // Below `lg` one pane shows at a time; both stay mounted so neither loses its place.
  const [pane, setPane] = useState<"conversation" | "diff">("conversation");
  const [focus, setFocus] = useState<DiffFocus | null>(null);
  const [draft, setDraft] = useRoomDraft(place);
  const canPost = useAtomValue(serverEnvironment.peerRooms.post.permissionAtom(environmentId));
  const canMove = useAtomValue(serverEnvironment.peerRooms.pass.permissionAtom(environmentId));

  const people = peopleOf(projectState.project.members, me, nameOf);
  const choices = choicesWithMentions(
    targetsFor(projectState.project, hubTask, runs.runs, me, {
      ...(read.room?.hasCheckout === undefined ? {} : { hasCheckout: read.room.hasCheckout }),
      reaches: read.room?.reaches ?? [],
      nameOf,
    }),
    people,
    draft.selected,
  );

  const openMessage = (seq: number) => {
    setPane("conversation");
    requestAnimationFrame(() =>
      document.getElementById(roomMessageId(seq))?.scrollIntoView({ block: "center" }),
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border/60 px-4 py-2 lg:hidden">
        <ToggleGroup
          aria-label="Show"
          value={[pane]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "conversation" || next === "diff") setPane(next);
          }}
        >
          <Toggle value="conversation">Conversation</Toggle>
          <Toggle value="diff">Diff</Toggle>
        </ToggleGroup>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <section
          aria-label="Conversation"
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col lg:flex lg:max-w-[42rem] lg:border-e lg:border-border",
            pane === "conversation" ? "flex" : "hidden",
          )}
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
            onOpenAnchor={(anchor) => {
              setPane("diff");
              setFocus({ anchor, ask: (focus?.ask ?? 0) + 1 });
            }}
          />
          {canPost ? (
            <RoomComposer
              environmentId={environmentId}
              place={place}
              choices={choices}
              people={people}
              hasOwnRun={hasOpenRun(runs.runs, me)}
              draft={draft}
              onDraftChange={setDraft}
              onSent={read.refresh}
            />
          ) : (
            <p className="shrink-0 border-t border-border px-4 py-3 text-sm text-muted-foreground sm:px-6">
              This connection can read the room but not write to it.
            </p>
          )}
        </section>
        <section
          aria-label="Diff"
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col lg:flex",
            pane === "diff" ? "flex" : "hidden",
          )}
        >
          <RoomDiff
            diff={diff.diff}
            error={diff.error}
            onRetry={diff.refresh}
            messages={read.messages}
            drafting={draft.anchor !== undefined}
            focus={focus}
            me={me}
            nameOf={nameOf}
            watch={watchable(taskNode.threads)}
            onWatch={onOpen}
            onComment={(anchor) => {
              if (canPost) setDraft({ ...draft, anchor });
              setPane("conversation");
            }}
            onOpenMessage={openMessage}
          />
        </section>
      </div>
    </div>
  );
}
