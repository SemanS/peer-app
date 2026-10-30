import { Checkbox } from "../../../ui/checkbox";
import { Radio, RadioGroup } from "../../../ui/radio-group";
import {
  isGroupPicked,
  isPicked,
  pickAll,
  pickGroup,
  pickTask,
  pickedCount,
  pickedIn,
  NO_WORK,
  type ProjectAccess,
  type WorkGroup,
  type WorkPick,
} from "./people.logic";

function Choice({
  value,
  title,
  text,
}: {
  readonly value: string;
  readonly title: string;
  readonly text: string;
}) {
  return (
    <label className="flex cursor-pointer items-baseline gap-2.5 text-sm">
      <Radio value={value} className="translate-y-0.5" />
      <span>
        <span className="font-medium text-foreground">{title}</span>
        <span className="text-muted-foreground"> — {text}</span>
      </span>
    </label>
  );
}

/**
 * Which projects someone works in: every project, or the ones ticked. The same fields in an
 * invitation, on a person's page and in answer to an ask to be added.
 */
export function ProjectAccessFields({
  value,
  projects,
  fixed = false,
  disabled,
  onChange,
}: {
  readonly value: ProjectAccess;
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** A lead names projects, and cannot offer every project. */
  readonly fixed?: boolean;
  readonly disabled: boolean;
  readonly onChange: (next: ProjectAccess) => void;
}) {
  const picked = value.mode === "selected" ? value.projects : [];
  const known = new Set(projects.map((project) => project.id));
  const choices = [
    ...projects,
    ...picked.filter((id) => !known.has(id)).map((id) => ({ id, name: id })),
  ];
  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      <legend className="pb-2 text-sm font-medium text-foreground">Project access</legend>
      {fixed ? null : (
        <RadioGroup
          value={value.mode}
          disabled={disabled}
          onValueChange={(next) =>
            onChange(next === "all" ? { mode: "all" } : { mode: "selected", projects: picked })
          }
        >
          <Choice value="selected" title="Selected projects" text="Choose where they can work" />
          <Choice
            value="all"
            title="All projects"
            text="Everything open to the team, new projects too"
          />
        </RadioGroup>
      )}
      {value.mode === "all" ? null : (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
          {choices.length === 0 ? (
            <p className="text-sm text-muted-foreground">This workspace has no projects yet.</p>
          ) : null}
          {choices.map((project) => (
            <label
              key={project.id}
              className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground"
            >
              <Checkbox
                checked={picked.includes(project.id)}
                disabled={disabled}
                onCheckedChange={(on) =>
                  onChange({
                    mode: "selected",
                    projects: on
                      ? [...picked.filter((id) => id !== project.id), project.id]
                      : picked.filter((id) => id !== project.id),
                  })
                }
              />
              {project.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Project access says what someone may use; this picks what they answer for. */
export function WorkChecklist({
  groups,
  pick,
  disabled,
  onChange,
}: {
  readonly groups: ReadonlyArray<WorkGroup>;
  readonly pick: WorkPick;
  readonly disabled: boolean;
  readonly onChange: (next: WorkPick) => void;
}) {
  if (groups.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No open tasks here. Import OpenSpec changes or add tasks in Work, then assign them.
      </p>
    );
  const all = pickAll(groups);
  const everything = pickedCount(pick, groups) === pickedCount(all, groups);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{pickedCount(pick, groups)}</span>
        <button
          type="button"
          className="text-foreground hover:underline disabled:opacity-50"
          disabled={disabled}
          onClick={() => onChange(everything ? NO_WORK : all)}
        >
          {everything ? "Clear" : "Select all"}
        </button>
      </div>
      {groups.map((group) => (
        <div
          key={group.id}
          className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3"
        >
          <div className="flex items-center justify-between gap-3 text-sm">
            <label className="flex min-w-0 cursor-pointer items-center gap-2.5 font-medium text-foreground">
              <Checkbox
                checked={isGroupPicked(pick, group)}
                disabled={disabled}
                onCheckedChange={(on) => onChange(pickGroup(pick, group, on))}
              />
              <span className="truncate">{group.title}</span>
            </label>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {pickedIn(pick, group)}/{group.tasks.length}
            </span>
          </div>
          {group.tasks.map((task) => (
            <label
              key={task.id}
              className="flex cursor-pointer items-center gap-2.5 ps-6 text-sm text-foreground"
            >
              <Checkbox
                checked={isPicked(pick, group, task.id)}
                disabled={disabled}
                onCheckedChange={(on) => onChange(pickTask(pick, group, task.id, on))}
              />
              <span className="min-w-0 truncate">{task.title}</span>
            </label>
          ))}
        </div>
      ))}
      {groups.some((group) => group.area !== null) ? (
        <p className="text-sm text-muted-foreground">
          Ticking a whole area includes the tasks added to it later.
        </p>
      ) : null}
    </div>
  );
}

/** What someone invited to one project works on: all of it, or the areas and tasks ticked. */
export function InviteWorkFields({
  groups,
  entire,
  pick,
  disabled,
  onEntireChange,
  onPickChange,
}: {
  readonly groups: ReadonlyArray<WorkGroup>;
  readonly entire: boolean;
  readonly pick: WorkPick;
  readonly disabled: boolean;
  readonly onEntireChange: (entire: boolean) => void;
  readonly onPickChange: (next: WorkPick) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      <legend className="pb-2 text-sm font-medium text-foreground">What can they work on?</legend>
      <RadioGroup
        value={entire ? "entire" : "selected"}
        disabled={disabled}
        onValueChange={(next) => onEntireChange(next === "entire")}
      >
        <Choice value="entire" title="Entire project" text="Nothing assigned yet" />
        <Choice value="selected" title="Selected areas or tasks" text="They own what you tick" />
      </RadioGroup>
      {entire ? null : (
        <WorkChecklist groups={groups} pick={pick} disabled={disabled} onChange={onPickChange} />
      )}
    </fieldset>
  );
}
