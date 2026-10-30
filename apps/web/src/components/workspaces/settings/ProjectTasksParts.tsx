import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRightIcon, EllipsisIcon, FolderIcon, GripVerticalIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { TitleInput } from "../marks";
import { progressLabel } from "../taskTree.logic";
import { below, type MenuPosition } from "../useWorkActions";
import { taskLabel, type WorkTaskNode } from "../workTree.logic";
import {
  TASK_TITLE_MAX,
  groupTitleProblem,
  groupTitleProblemText,
  inHeldOrder,
  movedOrder,
  siblingsUnder,
} from "./projectTasks.logic";

/** What every level of the tree shares. */
export interface TaskTreeProps {
  /** Every task of the part of the project the tree shows, in the tree's order. */
  readonly tasks: ReadonlyArray<WorkTaskNode>;
  readonly opened: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  /** The row being renamed. */
  readonly renaming: string | null;
  readonly onRenamed: (task: WorkTaskNode, title: string | null) => void;
  readonly onOpen: (task: WorkTaskNode) => void;
  readonly onMenu: (task: WorkTaskNode, position: MenuPosition) => void;
  /** Gives siblings the order `ids` holds; resolves once it is written. */
  readonly onReorder: (ids: ReadonlyArray<string>) => Promise<void>;
}

/** One item: a handle, its fold, its title and progress, a menu, and what sits under it. */
function TaskTreeRow({
  task,
  depth,
  busy,
  tree,
}: {
  readonly task: WorkTaskNode;
  readonly depth: number;
  readonly busy: boolean;
  readonly tree: TaskTreeProps;
}) {
  const renaming = tree.renaming === task.id;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: busy || renaming });
  const items = siblingsUnder(tree.tasks, task.id);
  const folds = items.length > 0;
  const open = folds && tree.opened.has(task.id);
  const label = taskLabel(task);
  const progress = progressLabel(task);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 rounded-lg bg-card shadow-lg")}
    >
      <div
        className="flex min-h-11 items-center gap-1 py-1 pe-2.5"
        style={{ paddingInlineStart: `${0.625 + depth * 1.25}rem` }}
      >
        <span className="touch-none">
          <Button
            ref={setActivatorNodeRef}
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Drag to reorder ${label}`}
            disabled={busy || renaming}
            {...attributes}
            {...listeners}
          >
            <GripVerticalIcon aria-hidden />
          </Button>
        </span>
        {folds ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`${open ? "Fold" : "Open"} ${label}`}
            aria-expanded={open}
            onClick={() => tree.onToggle(task.id)}
          >
            <ChevronRightIcon aria-hidden className={cn(open && "rotate-90")} />
          </Button>
        ) : (
          <span aria-hidden className="size-7 shrink-0 sm:size-6" />
        )}
        {renaming ? (
          <TitleInput
            value={task.title}
            label="Task title"
            onDone={(title) => tree.onRenamed(task, title)}
          />
        ) : (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => tree.onOpen(task)}
          >
            {task.kind === "group" ? (
              <FolderIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
            {task.key === undefined ? null : (
              <span className="shrink-0 font-mono text-2xs text-muted-foreground">{task.key}</span>
            )}
            <span
              className={cn(
                "min-w-0 truncate text-sm font-medium",
                task.done ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {task.title}
            </span>
          </button>
        )}
        {progress === null ? null : (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{progress}</span>
        )}
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={`More for ${label}`}
          disabled={busy}
          onClick={(event) => tree.onMenu(task, below(event))}
        >
          <EllipsisIcon aria-hidden />
        </Button>
      </div>
      {open ? <TaskTreeLevel siblings={items} depth={depth + 1} tree={tree} /> : null}
    </li>
  );
}

/**
 * One level of the tree, its own sorting context so a row moves only among its siblings and takes
 * what sits under it along. Reorder by a row's handle, or by keyboard: focus the handle, Space to
 * pick the row up, arrows to move it, Space to drop it. The dropped order holds until it is written,
 * since the Hub's answer comes after the drop.
 */
export function TaskTreeLevel({
  siblings,
  depth,
  tree,
}: {
  readonly siblings: ReadonlyArray<WorkTaskNode>;
  readonly depth: number;
  readonly tree: TaskTreeProps;
}) {
  const [held, setHeld] = useState<ReadonlyArray<string> | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const shown = held === null ? siblings : inHeldOrder(siblings, held);
  const ids = shown.map((task) => task.id);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null || active.id === over.id) return;
    const next = movedOrder(ids, String(active.id), String(over.id));
    setHeld(next);
    void tree.onReorder(next).then(() => setHeld(null));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul
          className={cn(
            "flex flex-col divide-y divide-border",
            depth > 0 && "border-t border-border",
          )}
        >
          {shown.map((task) => (
            <TaskTreeRow key={task.id} task={task} depth={depth} busy={held !== null} tree={tree} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

/** A field that adds a group at the end of the roots. */
export function NewGroupRow({ onAdd }: { readonly onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  // An empty name is a problem only once the person pressed Add on it.
  const [pressedEmpty, setPressedEmpty] = useState(false);
  const typed = title.trim() !== "";
  const problem = typed ? groupTitleProblem(title) : pressedEmpty ? "empty" : null;
  return (
    <form
      className="flex flex-col gap-1.5 p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!typed) setPressedEmpty(true);
        if (!typed || problem !== null) return;
        onAdd(title.trim());
        setTitle("");
      }}
    >
      <div className="flex gap-2">
        <Input
          nativeInput
          className="min-w-0 flex-1"
          size="sm"
          aria-label="New group"
          aria-invalid={problem !== null}
          placeholder="New group"
          value={title}
          maxLength={TASK_TITLE_MAX * 2}
          onChange={(event) => {
            setTitle(event.target.value);
            setPressedEmpty(false);
          }}
        />
        <Button type="submit" size="sm" variant="outline">
          Add
        </Button>
      </div>
      {problem === null ? null : (
        <p role="alert" className="text-xs text-destructive-foreground">
          {groupTitleProblemText(problem)}
        </p>
      )}
    </form>
  );
}
