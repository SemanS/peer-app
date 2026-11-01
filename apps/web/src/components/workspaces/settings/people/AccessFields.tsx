import { Checkbox } from "../../../ui/checkbox";
import { Radio, RadioGroup } from "../../../ui/radio-group";
import type { ProjectAccess } from "./people.logic";

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
