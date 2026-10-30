import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";

import { Button } from "../../../ui/button";
import { MoveUnderDialog } from "../../MoveUnderDialog";
import { NewTaskDialog } from "../../NewTaskDialog";
import { kindChange, servesTree } from "../../taskTree.logic";
import { projectCheckout } from "../../useOpenWorkspaceProject";
import { pickFromMenu, useWorkActions, type MenuPosition } from "../../useWorkActions";
import { buildWorkTree, type WorkTaskNode } from "../../workTree.logic";
import type { ProjectPageProps } from "../pageProps";
import { NewGroupRow, TaskTreeLevel, type TaskTreeProps } from "../ProjectTasksParts";
import {
  positionAfter,
  positionChanges,
  removalMoves,
  siblingsUnder,
  structureMenuItems,
} from "../projectTasks.logic";
import { ProjectAreas } from "./ProjectAreas";

const NO_THREADS: ReadonlyArray<never> = [];

type Dialog =
  | { readonly kind: "new"; readonly parent: string | null }
  | { readonly kind: "move"; readonly task: WorkTaskNode };

/**
 * A project's Tasks tab: its tasks as the tree they are, a group holding the tasks that belong
 * together. Anyone on the project arranges them, as the Work menus let them, and each change goes to
 * the Hub at once. Without a tree on the Hub the rows stay flat and nothing offers a group, except on
 * a project with no tasks, which cannot tell. A project that still has areas keeps them below.
 */
export function ProjectTasks(props: ProjectPageProps) {
  const { environmentId, status, workspace, state } = props;
  const { project } = state;
  const navigate = useNavigate();
  const headingId = useId();
  const actions = useWorkActions(environmentId);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Threads are not shown here, so the tree needs none and no clock.
  const node = buildWorkTree({ status, localThreads: NO_THREADS, now: 0 }).find(
    (candidate) => candidate.workspace === workspace.slug && candidate.projectId === project.id,
  );
  if (node === undefined) return null;

  const scope = { workspace: workspace.slug, projectId: project.id };
  const tree = servesTree(node);
  const positions = new Map(node.tasks.map((task) => [task.id, task.position]));
  const named = node.areas.some((area) => area.name !== null);
  const all = node.areas.flatMap((area) => area.tasks);

  const onMenu = async (task: WorkTaskNode, position: MenuPosition) => {
    const choice = await pickFromMenu(structureMenuItems({ task, tree }), position);
    if (choice === "add-under") setDialog({ kind: "new", parent: task.id });
    else if (choice === "move-under") setDialog({ kind: "move", task });
    else if (choice === "make-group" || choice === "make-task")
      void actions.changeTaskTree(
        scope,
        task,
        kindChange(choice === "make-group" ? "group" : "task"),
      );
    else if (choice === "rename") setRenaming(task.id);
    else if (choice === "remove") {
      const items = siblingsUnder(all, task.id).map((item) => item.id);
      const moves = removalMoves({
        task,
        area: node.tasks.find((candidate) => candidate.id === task.id)?.area,
        items,
        siblings: siblingsUnder(all, task.parent).map((sibling) => sibling.id),
        positions,
      });
      void actions.removeItem(scope, task, items.length, moves);
    }
  };

  const shared: Omit<TaskTreeProps, "tasks"> = {
    opened,
    onToggle: (id) =>
      setOpened((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    renaming,
    onRenamed: (task, title) => {
      setRenaming(null);
      if (title !== null) void actions.renameTask(scope, task, title);
    },
    onOpen: (task) =>
      void navigate({
        to: "/task/$workspace/$project/$task",
        params: { workspace: workspace.slug, project: project.id, task: task.id },
      }),
    onMenu: (task, position) => void onMenu(task, position),
    onReorder: (ids) => actions.placeTasks(scope, positionChanges(ids, positions)),
  };

  return (
    <>
      <section aria-labelledby={headingId} className="flex max-w-2xl flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={headingId} className="text-sm font-semibold text-foreground">
            Tasks
          </h2>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setDialog({ kind: "new", parent: null })}
          >
            New task
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          A group holds the tasks that belong together. An agent given a group works through its
          open items in this order.
        </p>
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {node.areas.map((area) => (
            <div key={area.name ?? ""}>
              {named ? (
                <h3 className="px-3.5 pt-2.5 pb-1 text-xs font-medium text-muted-foreground">
                  {area.name ?? "No area"}
                </h3>
              ) : null}
              <TaskTreeLevel
                siblings={siblingsUnder(area.tasks, undefined)}
                depth={0}
                tree={{ ...shared, tasks: area.tasks }}
              />
            </div>
          ))}
          {all.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No tasks yet.</p>
          ) : null}
          {tree || all.length === 0 ? (
            <NewGroupRow
              onAdd={(title) =>
                void actions.addGroup(
                  scope,
                  title,
                  positionAfter(
                    siblingsUnder(all, undefined).map((task) => positions.get(task.id)),
                  ),
                )
              }
            />
          ) : null}
        </div>
        {all.length === 0 ? null : (
          <p className="text-xs text-muted-foreground">
            Drag a row by its handle to reorder it among its neighbours.
            {tree ? " Its menu moves it under another item." : ""}
          </p>
        )}
      </section>
      <ProjectAreas {...props} />
      {dialog?.kind === "new" ? (
        <NewTaskDialog
          environmentId={environmentId}
          project={node}
          t3ProjectId={projectCheckout(state).projectId}
          parent={dialog.parent}
          onClose={() => setDialog(null)}
        />
      ) : dialog?.kind === "move" ? (
        <MoveUnderDialog
          project={node}
          task={dialog.task}
          onMove={(parent) => void actions.moveTaskUnder(scope, dialog.task, parent)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
