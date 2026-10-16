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
  return (
    <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-2xs text-muted-foreground">
      {children}
    </span>
  );
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
      {task.key === undefined ? null : <TaskKey>{task.key}</TaskKey>}
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
    <WorkspacePageHeader electron={isElectron} className="border-b border-border">
      <Button size="xs" variant="outline" onClick={() => void navigate({ to: "/work" })}>
        <ChevronLeftIcon aria-hidden />
        Board
      </Button>
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground"
      >
        {project === undefined ? null : (
          <>
            <ProjectMark name={project.name} colorKey={project.colorKey} className="size-4.5" />
            <span className="max-w-40 shrink-0 truncate text-foreground/80">{project.name}</span>
            <Separator />
          </>
        )}
        {task === undefined ? null : (
          <>
            {taskPage === undefined ? (
              <TaskCrumb task={task} />
            ) : (
              <Link
                to="/task/$workspace/$project/$task"
                params={taskPage}
                className="flex min-w-0 items-center gap-1.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <TaskCrumb task={task} />
              </Link>
            )}
            <Separator />
          </>
        )}
        <span className="min-w-0 truncate font-semibold text-foreground">{page}</span>
        {after}
      </nav>
      {state === undefined ? null : (
        <Badge variant={TONE_BADGE[state.tone]} size="control">
          {state.label}
        </Badge>
      )}
      {actions}
    </WorkspacePageHeader>
  );
}

/** A section's name over its content, in small capitals. */
export function PeerSectionLabel({
  children,
  after,
}: {
  readonly children: ReactNode;
  /** Beside the name, e.g. a count chip. */
  readonly after?: ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
      {after}
    </h2>
  );
}

/** A bordered card on a Peer page, with the padding the Work design gives cards. */
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
      className={cn("flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4", className)}
    >
      {children}
    </section>
  );
}
