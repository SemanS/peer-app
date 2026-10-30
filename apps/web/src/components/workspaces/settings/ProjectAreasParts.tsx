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
import { GripVerticalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import {
  AREA_NAME_MAX,
  nameProblem,
  problemText,
  taskCount,
  type AreaRow,
  type AreaRows,
} from "./projectAreas.logic";

/** The text of an area's task count: "6 tasks". */
function Count({ tasks }: { readonly tasks: number }) {
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{taskCount(tasks)}</span>
  );
}

function Problem({ children }: { readonly children: ReactNode }) {
  return (
    <p role="alert" className="text-xs text-destructive-foreground">
      {children}
    </p>
  );
}

/** An area's name as a field, with Done: Enter finishes, Escape leaves the name as it was. */
function RenameField({
  name,
  others,
  onDone,
  onCancel,
}: {
  readonly name: string;
  readonly others: ReadonlyArray<string>;
  readonly onDone: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  const unchanged = value.trim() === name;
  const problem = unchanged ? null : nameProblem(value, others);
  const finish = () => {
    if (unchanged) onCancel();
    else if (problem === null) onDone(value.trim());
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          nativeInput
          autoFocus
          size="sm"
          aria-label="Area name"
          aria-invalid={problem !== null}
          value={value}
          maxLength={AREA_NAME_MAX * 2}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") finish();
            if (event.key === "Escape") onCancel();
          }}
        />
        <Button size="xs" onClick={finish}>
          Done
        </Button>
      </div>
      {problem === null ? null : <Problem>{problemText(problem)}</Problem>}
    </div>
  );
}

/** One listed area: a handle to drag it by, its name and tasks, rename and delete. */
function SortableRow({
  row,
  editable,
  busy,
  renaming,
  others,
  onRenameStart,
  onRenameDone,
  onRenameCancel,
  onDelete,
}: {
  readonly row: AreaRow;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly renaming: boolean;
  readonly others: ReadonlyArray<string>;
  readonly onRenameStart: () => void;
  readonly onRenameDone: (name: string) => void;
  readonly onRenameCancel: () => void;
  readonly onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.name, disabled: !editable || busy || renaming });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex min-h-12 items-center gap-2 px-2.5 py-1.5",
        isDragging && "relative z-10 rounded-lg bg-card shadow-lg",
      )}
    >
      {editable ? (
        <span className="touch-none">
          <Button
            ref={setActivatorNodeRef}
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Drag to reorder ${row.name}`}
            disabled={busy || renaming}
            {...attributes}
            {...listeners}
          >
            <GripVerticalIcon aria-hidden />
          </Button>
        </span>
      ) : null}
      {renaming ? (
        <RenameField
          name={row.name}
          others={others}
          onDone={onRenameDone}
          onCancel={onRenameCancel}
        />
      ) : (
        <>
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-medium text-foreground",
              !editable && "ps-1.5",
            )}
          >
            {row.name}
          </span>
          <Count tasks={row.tasks} />
          {editable ? (
            <>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`Rename ${row.name}`}
                disabled={busy}
                onClick={onRenameStart}
              >
                <PencilIcon aria-hidden />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost-destructive"
                aria-label={`Delete ${row.name}`}
                disabled={busy}
                onClick={onDelete}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </>
          ) : null}
        </>
      )}
    </li>
  );
}

/** An area that exists only because tasks name it: it can be taken into the list, or left. */
function FromTaskRow({
  row,
  editable,
  busy,
  onAdopt,
}: {
  readonly row: AreaRow;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly onAdopt: () => void;
}) {
  return (
    <li className="flex min-h-12 items-center gap-2 px-2.5 py-1.5">
      {/* Where a listed area has its handle, so the names line up. */}
      {editable ? <span aria-hidden className="size-7 shrink-0 sm:size-6" /> : null}
      <span className={cn("flex min-w-0 flex-1 items-baseline gap-2", !editable && "ps-1.5")}>
        <span className="min-w-0 truncate font-medium text-foreground">{row.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">from a task</span>
      </span>
      <Count tasks={row.tasks} />
      {editable ? (
        <Button
          size="xs"
          variant="outline"
          aria-label={`Add to list: ${row.name}`}
          disabled={busy}
          onClick={onAdopt}
        >
          Add to list
        </Button>
      ) : null}
    </li>
  );
}

/**
 * The areas in their order, as a list to reorder by dragging a row's handle (or by keyboard: focus
 * the handle, Space to pick the row up, arrows to move it, Space to drop it), with each area's task
 * count, rename and delete, then the areas only tasks name.
 */
export function AreaList({
  rows,
  editable,
  busy,
  onReorder,
  onRename,
  onDelete,
  onAdopt,
}: {
  readonly rows: AreaRows;
  readonly editable: boolean;
  /** Tasks are moving: everything stays where it is and nothing can be touched. */
  readonly busy: boolean;
  /** `name` was dropped where `over` is. */
  readonly onReorder: (name: string, over: string) => void;
  readonly onRename: (from: string, to: string) => void;
  /** Asks to delete an area; the page then asks where its tasks go. */
  readonly onDelete: (name: string) => void;
  readonly onAdopt: (name: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const names = rows.listed.map((row) => row.name);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over !== null && active.id !== over.id) onReorder(String(active.id), String(over.id));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={names} strategy={verticalListSortingStrategy}>
        <ul
          aria-label="Areas"
          className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card"
        >
          {rows.listed.map((row) => (
            <SortableRow
              key={row.name}
              row={row}
              editable={editable}
              busy={busy}
              renaming={renaming === row.name}
              others={names.filter((name) => name !== row.name)}
              onRenameStart={() => setRenaming(row.name)}
              onRenameDone={(to) => {
                setRenaming(null);
                onRename(row.name, to);
              }}
              onRenameCancel={() => setRenaming(null)}
              onDelete={() => onDelete(row.name)}
            />
          ))}
          {rows.fromTasks.map((row) => (
            <FromTaskRow
              key={`task:${row.name}`}
              row={row}
              editable={editable}
              busy={busy}
              onAdopt={() => onAdopt(row.name)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

const NONE = "none";

/**
 * Asks where an area's tasks go before it is deleted: another area, or none. Nothing is deleted
 * here; the choice goes into the draft, and the tasks move once the list is saved.
 */
export function DeleteAreaPanel({
  name,
  tasks,
  targets,
  onConfirm,
  onCancel,
}: {
  readonly name: string;
  readonly tasks: number;
  /** The other areas of the list, in order. */
  readonly targets: ReadonlyArray<string>;
  /** `to` is the area the tasks move to; null takes them out of any area. */
  readonly onConfirm: (to: string | null) => void;
  readonly onCancel: () => void;
}) {
  const [choice, setChoice] = useState(NONE);
  const items = [
    ...targets.map((target) => ({ value: `area:${target}`, label: target })),
    { value: NONE, label: "No area" },
  ];
  return (
    <section
      aria-label={`Delete ${name}`}
      className="flex flex-col gap-2.5 rounded-xl border border-destructive/32 bg-destructive/4 p-3.5"
    >
      <h3 className="text-sm font-semibold text-foreground">Delete {name}?</h3>
      {tasks === 0 ? (
        <p className="text-sm text-muted-foreground">It has no tasks.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
          <span>
            Its {taskCount(tasks)} {tasks === 1 ? "moves" : "move"} to
          </span>
          <div className="w-48">
            <Select
              value={choice}
              items={items}
              onValueChange={(value) => {
                if (value !== null) setChoice(value);
              }}
            >
              <SelectTrigger size="sm" aria-label={`Move the tasks of ${name} to`}>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={() => onConfirm(choice === NONE ? null : choice.slice("area:".length))}
        >
          {tasks === 0 ? "Delete" : "Delete and move"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
