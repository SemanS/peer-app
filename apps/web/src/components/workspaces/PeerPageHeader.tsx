/**
 * The header every Peer page shares, after the Work design: back to the Work board, where the page
 * is (project › task › page) and, on the right, the state of what it shows in its signal's tone.
 * Under it, pages use the same small parts: section labels and cards.
 */
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ProjectMark, TONE_BADGE, type SignalTone } from "./signals";
import { taskIdOfParams } from "./task/taskRoute.logic";

/** A task's tracker key, as every Work view writes it. */
export function TaskKey({ children }: { readonly children: ReactNode }) {
  return <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{children}</span>;
}

function Separator() {
  return <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />;
}

/**
 * The task a page is about, as its route names it: the review page by a `task` param, the task
 * context page by a `task:<id>` scope. The task's crumb opens the task's page from either.
 */
function useTaskOfRoute(): { workspace: string; project: string; task: string } | undefined {
  const workspace = useParams({ strict: false, select: (params) => params.workspace });
  const project = useParams({ strict: false, select: (params) => params.project });
  const task = useParams({ strict: false, select: taskIdOfParams });
  return workspace && project && task ? { workspace, project, task } : undefined;
}

function TaskCrumb({
  task,
}: {
  readonly task: { readonly key?: string | undefined; readonly title: string };
}) {
  return (
    <>
      {task.key === undefined ? null : (
        <span className="min-w-0 truncate">
          <TaskKey>{task.key}</TaskKey>
        </span>
      )}
      <span className="hidden max-w-56 min-w-0 truncate text-foreground/80 sm:inline">
        {task.title}
      </span>
    </>
  );
}

export function PeerPageHeader({
  project,
  task,
  page,
  after,
  state,
  actions,
}: {
  /** The project the page is in; its mark comes from `colorKey` (`<workspace>/<project>`). */
  readonly project?: { readonly name: string; readonly colorKey: string } | undefined;
  readonly task?: { readonly key?: string | undefined; readonly title: string } | undefined;
  /** What the page is: the thread, "Task context", "Knowledge to keep", … */
  readonly page: ReactNode;
  /** Right after the page's name, e.g. how many wait. */
  readonly after?: ReactNode;
  /** Where things stand, as a pill in the signal's tone. */
  readonly state?: { readonly label: ReactNode; readonly tone: SignalTone } | undefined;
  /** Buttons at the end of the header. */
  readonly actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const taskPage = useTaskOfRoute();
  return (
    <>
      <WorkspacePageHeader electron={isElectron} className="border-b border-border">
        <Button size="sm" variant="ghost" onClick={() => void navigate({ to: "/work" })}>
          <ChevronLeftIcon aria-hidden />
          Board
        </Button>
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm text-muted-foreground"
        >
          {project === undefined ? null : (
            <span className="hidden min-w-0 items-center gap-1.5 lg:contents">
              <ProjectMark name={project.name} colorKey={project.colorKey} className="size-4.5" />
              <span className="max-w-40 min-w-0 truncate text-foreground/80">{project.name}</span>
              <Separator />
            </span>
          )}
          {task === undefined ? null : (
            <span className="hidden min-w-0 items-center gap-1.5 lg:contents">
              {taskPage === undefined ? (
                <TaskCrumb task={task} />
              ) : (
                <Link
                  to="/task/$workspace/$project/$task"
                  params={taskPage}
                  className="flex min-w-0 max-w-64 items-center gap-1.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <TaskCrumb task={task} />
                </Link>
              )}
              <Separator />
            </span>
          )}
          <span className="min-w-0 truncate font-semibold text-foreground lg:shrink-0">{page}</span>
          {after}
        </nav>
        {state === undefined ? null : (
          <span className="hidden lg:block">
            <Badge variant={TONE_BADGE[state.tone]} size="control">
              {state.label}
            </Badge>
          </span>
        )}
        {actions}
      </WorkspacePageHeader>
      {project === undefined && task === undefined && state === undefined ? null : (
        <div className="flex max-h-[30dvh] min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 overflow-y-auto border-b border-border/60 px-4 py-3 text-xs text-muted-foreground lg:hidden">
          <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1 [overflow-wrap:anywhere]">
            {project === undefined ? null : <span>{project.name}</span>}
            {task === undefined ? null : taskPage === undefined ? (
              <span className="text-foreground">
                {task.key ?? task.title}
                {task.key === undefined ? null : <span className="sr-only"> · {task.title}</span>}
              </span>
            ) : (
              <Link
                to="/task/$workspace/$project/$task"
                params={taskPage}
                aria-label={[task.key, task.title].filter(Boolean).join(" · ")}
                className="rounded-sm text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {task.key ?? task.title}
              </Link>
            )}
          </div>
          {state === undefined ? null : (
            <Badge variant={TONE_BADGE[state.tone]} size="control">
              {state.label}
            </Badge>
          )}
        </div>
      )}
    </>
  );
}

/** A section's name over its content. */
export function PeerSectionLabel({
  children,
  after,
}: {
  readonly children: ReactNode;
  /** Beside the name, e.g. a count chip. */
  readonly after?: ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
      {children}
      {after}
    </h2>
  );
}

/** Related content separated from the next section by a single rule. */
export function PeerCard({
  children,
  className,
  "aria-label": label,
}: {
  readonly children: ReactNode;
  /** Layout only: width, gap, placement. */
  readonly className?: string;
  readonly "aria-label"?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn("flex min-w-0 flex-col gap-4 border-t border-border/60 py-5", className)}
    >
      {children}
    </section>
  );
}
