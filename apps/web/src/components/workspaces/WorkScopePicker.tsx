import { ChevronsUpDownIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { projectIconColorClassName } from "../../projectIconColors";
import {
  Menu,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { ProjectMark, SignalCount, projectColor } from "./signals";
import {
  ALL_PROJECTS,
  projectCounts,
  projectScopeKey,
  projectTaskCount,
  type ColumnCounts,
} from "./workBoard.logic";
import type { WorkProjectNode } from "./workTree.logic";

/** Every project at once: a square of the first projects' colors. */
export function AllProjectsMark({
  tree,
  className,
}: {
  readonly tree: ReadonlyArray<WorkProjectNode>;
  readonly className?: string;
}) {
  const colors = tree.slice(0, 4).map((project) => projectColor(projectScopeKey(project)));
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 shrink-0 grid-cols-2 gap-px rounded-[25%] bg-muted p-0.5",
        className,
      )}
    >
      {[0, 1, 2, 3].map((index) => {
        const color = colors[index];
        return (
          <span
            key={index}
            className={cn(
              "rounded-xs",
              color === undefined ? "bg-muted-foreground/30" : projectIconColorClassName(color),
            )}
            style={color === undefined ? undefined : { backgroundColor: "currentColor" }}
          />
        );
      })}
    </span>
  );
}

/** Needs input, working and in review, as small counts in their colors. */
export function ColumnCountMarks({ counts }: { readonly counts: ColumnCounts }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <SignalCount tone="needs" count={counts.needs} label="need input" />
      <SignalCount tone="working" count={counts.working} label="working" />
      <SignalCount tone="delivery" count={counts.review} label="need review" />
    </span>
  );
}

/**
 * Which project the Work views show: all of them, or one, so the work of different projects never
 * mixes. The same choice scopes the sidebar and the Work board.
 */
export function WorkScopePicker({
  tree,
  scope,
  onChange,
  showWorkspace,
}: {
  readonly tree: ReadonlyArray<WorkProjectNode>;
  readonly scope: string;
  readonly onChange: (scope: string) => void;
  readonly showWorkspace: boolean;
}) {
  const current = tree.find((project) => projectScopeKey(project) === scope);
  const needInput = tree.reduce((total, project) => total + projectCounts(project).needs, 0);
  const subtitle =
    current === undefined
      ? `${tree.length} ${tree.length === 1 ? "project" : "projects"}${needInput > 0 ? ` · ${needInput} need input` : ""}`
      : `${showWorkspace ? `${current.workspaceName} · ` : ""}${projectTaskCount(current)} ${projectTaskCount(current) === 1 ? "task" : "tasks"}`;
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Choose the project the Work views show"
            className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-control-surface px-2.5 py-2 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-active"
          />
        }
      >
        {current === undefined ? (
          <AllProjectsMark tree={tree} className="size-7" />
        ) : (
          <ProjectMark name={current.name} colorKey={projectScopeKey(current)} className="size-7" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-2xs font-medium text-muted-foreground">Project</span>
          <span className="truncate text-sm font-semibold text-sidebar-foreground">
            {current === undefined ? "All projects" : current.name}
          </span>
        </span>
        <span className="max-w-24 shrink truncate text-xs text-muted-foreground">{subtitle}</span>
        <ChevronsUpDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-(--anchor-width) min-w-64">
        <MenuRadioGroup
          value={current === undefined ? ALL_PROJECTS : scope}
          onValueChange={(value) => onChange(String(value))}
        >
          <MenuRadioItem value={ALL_PROJECTS}>
            <span className="flex min-w-0 items-center gap-2.5">
              <AllProjectsMark tree={tree} className="size-5" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">All projects</span>
                <span className="truncate text-xs text-muted-foreground">
                  Everything, grouped by project
                </span>
              </span>
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
          <MenuGroupLabel>Projects</MenuGroupLabel>
          {tree.map((project) => {
            const key = projectScopeKey(project);
            return (
              <MenuRadioItem key={key} value={key}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <ProjectMark name={project.name} colorKey={key} className="size-5" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{project.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {showWorkspace ? `${project.workspaceName} · ` : ""}
                      {projectTaskCount(project)}{" "}
                      {projectTaskCount(project) === 1 ? "task" : "tasks"}
                    </span>
                  </span>
                  <ColumnCountMarks counts={projectCounts(project)} />
                  <MenuRadioItemIndicator />
                </span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
