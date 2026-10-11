import type { ContextMenuItem, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useComposerDraftStore } from "../../composerDraftStore";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { readLocalApi } from "../../localApi";
import { readThreadShell } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { confirmed, reportFailure } from "./workFeedback";
import { taskLabel, type WorkOpen, type WorkTaskNode } from "./workTree.logic";

export interface MenuPosition {
  readonly x: number;
  readonly y: number;
}

/** Shows a menu through the bridge the Threads list uses: native on desktop. */
export async function pickFromMenu<T extends string>(
  items: ReadonlyArray<ContextMenuItem<T>>,
  position: MenuPosition,
): Promise<T | null> {
  const api = readLocalApi();
  if (api === undefined || items.length === 0) return null;
  const picked = await settlePromise(() => api.contextMenu.show(items, position));
  return picked._tag === "Success" ? picked.value : null;
}

export function below(event: ReactMouseEvent<HTMLElement>): MenuPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 4 };
}

export type ThreadOpen = Extract<WorkOpen, { readonly kind: "thread" }>;

export interface Scope {
  readonly workspace: string;
  readonly projectId: string;
}

/**
 * Everything the tree does to threads and tasks, set up once for the panel:
 * opening, renaming, archiving and deleting your threads, placing them on
 * tasks, and the tasks' own changes.
 */
export function useWorkActions(environmentId: EnvironmentId | null) {
  const navigate = useNavigate();
  const assignThread = useAtomCommand(serverEnvironment.peerHubAssignThread, {
    reportFailure: false,
  });
  const updateTask = useAtomCommand(serverEnvironment.peerHubUpdateTask, { reportFailure: false });
  const deleteTask = useAtomCommand(serverEnvironment.peerHubDeleteTask, { reportFailure: false });
  const unshareProject = useAtomCommand(serverEnvironment.peerHubUnshareProject, {
    reportFailure: false,
  });
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const openNewThread = useNewThreadHandler();
  const { archiveThread, confirmAndDeleteThread } = useThreadActions();
  const confirmThreadArchive = useClientSettings((s) => s.confirmThreadArchive);

  return {
    environmentId,
    /** Opens a local thread, or a herdr agent in Peer's agent view. */
    open: (open: WorkOpen) => {
      if (open.kind === "thread") {
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(open.environmentId, open.threadId)),
        });
        return;
      }
      if (open.kind === "observe") {
        void navigate({
          to: "/observe/$workspace/$environment/$thread",
          params: { workspace: open.workspace, environment: open.environment, thread: open.thread },
        });
        return;
      }
      if (open.kind === "context") {
        void navigate({
          to: "/context/$workspace/$project/$scope",
          params: { workspace: open.workspace, project: open.project, scope: open.scope },
        });
        return;
      }
      void navigate({ to: "/agent/$agentId", params: { agentId: open.agentId } });
    },
    renameThread: async (open: ThreadOpen, title: string, before: string) => {
      const trimmed = title.trim();
      if (trimmed === "" || trimmed === before) return;
      reportFailure(
        "Could not rename the thread",
        await updateThreadMetadata({
          environmentId: open.environmentId,
          input: { threadId: open.threadId, title: trimmed },
        }),
      );
    },
    archiveThread: async (open: ThreadOpen, title: string) => {
      if (confirmThreadArchive && !(await confirmed(`Archive thread "${title}"?`))) return;
      reportFailure(
        "Could not archive the thread",
        await archiveThread(scopeThreadRef(open.environmentId, open.threadId)),
      );
    },
    deleteThread: async (open: ThreadOpen) => {
      const ref = scopeThreadRef(open.environmentId, open.threadId);
      const result = await confirmAndDeleteThread(ref);
      // Once the thread is gone, a failure is its worktree's cleanup, which reports itself.
      if (readThreadShell(ref) !== null) reportFailure("Could not delete the thread", result);
    },
    placeThread: async (scope: Scope, thread: string, taskId: string | null) => {
      if (environmentId === null) return;
      reportFailure(
        "Could not move the thread",
        await assignThread({ environmentId, input: { ...scope, thread, taskId } }),
      );
    },
    startThread: async (scope: Scope, taskId: string, projectId: ProjectId) => {
      if (environmentId === null) return;
      const draft = await openNewThread(scopeProjectRef(environmentId, projectId));
      if (draft === null) return;
      useComposerDraftStore.getState().setDraftThreadContext(draft.draftId, {
        workTask: { ...scope, taskId },
      });
    },
    renameTask: async (scope: Scope, task: WorkTaskNode, title: string) => {
      const trimmed = title.trim();
      if (environmentId === null || trimmed === "" || trimmed === task.title) return;
      reportFailure(
        "Could not rename the task",
        await updateTask({ environmentId, input: { ...scope, taskId: task.id, title: trimmed } }),
      );
    },
    /** Moves a task to an area of its project, or (`null`) out of its area. */
    moveTaskToArea: async (scope: Scope, task: WorkTaskNode, area: string | null) => {
      if (environmentId === null) return;
      reportFailure(
        `Could not move ${taskLabel(task)}`,
        // The Hub takes an empty area as none.
        await updateTask({
          environmentId,
          input: { ...scope, taskId: task.id, area: area ?? "" },
        }),
      );
    },
    setTaskDone: async (scope: Scope, task: WorkTaskNode, done: boolean) => {
      if (environmentId === null) return;
      reportFailure(
        `Could not update ${taskLabel(task)}`,
        await updateTask({
          environmentId,
          input: { ...scope, taskId: task.id, status: done ? "done" : "open" },
        }),
      );
    },
    removeTask: async (scope: Scope, task: WorkTaskNode) => {
      if (environmentId === null) return;
      const sure = await confirmed(
        [
          `Remove task "${taskLabel(task)}" for everyone on the project?`,
          "Its threads stay, on no task.",
        ].join("\n"),
        true,
      );
      if (!sure) return;
      reportFailure(
        `Could not remove ${taskLabel(task)}`,
        await deleteTask({ environmentId, input: { ...scope, taskId: task.id } }),
      );
    },
    /** Takes a project someone shared from Peer out of the workspace, for everyone. */
    removeProject: async (scope: Scope, name: string, workspaceName: string) => {
      if (environmentId === null) return;
      const sure = await confirmed(
        [
          `Remove project "${name}" from ${workspaceName} for everyone?`,
          "It leaves Work for every member. Clones on their computers stay; sharing it again brings it back.",
        ].join("\n"),
        true,
      );
      if (!sure) return;
      reportFailure(
        `Could not remove ${name}`,
        await unshareProject({ environmentId, input: scope }),
      );
    },
  };
}

export type WorkActions = ReturnType<typeof useWorkActions>;
