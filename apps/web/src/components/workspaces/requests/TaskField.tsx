import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { REQUEST_TITLE_MAX, type TaskOption } from "./requests.logic";

/** The area select's value for a task in none; an area's own name can be anything else. */
const NO_AREA = "__no-area__";

export type TaskMode = "existing" | "new";

/**
 * What the request is about: one of the project's open tasks, or a new task by its title (and area).
 * The Hub makes the new task when it takes the request, and keeps it if the request is not accepted,
 * so the field says so.
 */
export function TaskField({
  id,
  mode,
  onModeChange,
  options,
  taskId,
  onTaskIdChange,
  title,
  onTitleChange,
  areas,
  area,
  onAreaChange,
  projectName,
  disabled,
}: {
  readonly id: string;
  readonly mode: TaskMode;
  readonly onModeChange: (mode: TaskMode) => void;
  readonly options: ReadonlyArray<TaskOption>;
  readonly taskId: string;
  readonly onTaskIdChange: (taskId: string) => void;
  readonly title: string;
  readonly onTitleChange: (title: string) => void;
  /** The project's areas in its order. */
  readonly areas: ReadonlyArray<string>;
  /** The area a new task goes to; "" for none. */
  readonly area: string;
  readonly onAreaChange: (area: string) => void;
  readonly projectName: string;
  readonly disabled: boolean;
}) {
  const task = options.find((option) => option.id === taskId);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ToggleGroup
        aria-label="Which task"
        value={[mode]}
        disabled={disabled}
        onValueChange={(values) => {
          const next = values[0];
          if (next === "existing" || next === "new") onModeChange(next);
        }}
      >
        <Toggle value="existing" disabled={options.length === 0}>
          An open task
        </Toggle>
        <Toggle value="new">A new task</Toggle>
      </ToggleGroup>
      {mode === "existing" ? (
        <Select
          value={task === undefined ? null : task.id}
          disabled={disabled}
          onValueChange={(next) => onTaskIdChange(typeof next === "string" ? next : "")}
        >
          <SelectTrigger id={id} aria-label="Open task">
            <SelectValue placeholder="Choose a task">
              {task === undefined ? undefined : task.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {options.map((option) => (
              <SelectItem key={option.id} hideIndicator value={option.id}>
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate">{option.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{option.state}</span>
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Input
              id={id}
              aria-label="New task title"
              maxLength={REQUEST_TITLE_MAX}
              placeholder="For example: Allergen icons on the menu"
              value={title}
              disabled={disabled}
              onChange={(event) => onTitleChange(event.target.value)}
            />
            {areas.length === 0 ? null : (
              <Select
                value={area === "" ? NO_AREA : area}
                disabled={disabled}
                onValueChange={(next) =>
                  onAreaChange(typeof next !== "string" || next === NO_AREA ? "" : next)
                }
              >
                <SelectTrigger aria-label="Area">
                  <SelectValue>{area === "" ? "No area" : area}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {areas.map((name) => (
                    <SelectItem key={name} hideIndicator value={name}>
                      {name}
                    </SelectItem>
                  ))}
                  <SelectItem hideIndicator value={NO_AREA}>
                    No area
                  </SelectItem>
                </SelectPopup>
              </Select>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {`It becomes a task in ${projectName} as soon as you send this, and stays if it is declined or withdrawn.`}
          </p>
        </>
      )}
    </div>
  );
}
