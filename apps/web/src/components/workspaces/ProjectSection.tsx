import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ProjectActions } from "./ProjectActions";
import { SignalTiles } from "./ProjectSignals";
import { NavCount } from "./SidebarNav";
import {
  openAreasByDefault,
  sidebarTasks,
  tasksCountLabel,
  type SidebarArea,
} from "./sidebarTasks.logic";
import { TaskRow } from "./TaskRow";
import type { NestedRow } from "./taskTree.logic";
import type { PeerWebPlugin } from "./slots.types";
import {
  projectCheckout,
  type ProjectCheckout,
  useOpenWorkspaceProject,
} from "./useOpenWorkspaceProject";
import type { WorkActions } from "./useWorkActions";
import type { AgentNeed, WorkProjectNode, WorkTaskNode } from "./workTree.logic";

/** Signals another place already holds: a tab of their own, Needs your attention, the project menu. */
const PLACED_SIGNALS: ReadonlySet<string> = new Set([
  "overlaps",
  "knowledge",
  "memory",
  "team",
  "changes",
]);

/**
 * The open project in the Tasks tab: what holds now (its announcement, what it has in place), then
 * its areas with what each has done and each task's name and state. Done tasks fold inside their
 * area. What the rows do not say is on the task's page.
 */
export function ProjectSection({
  environmentId,
  status,
  project,
  plugins,
  activeThread,
  actions,
  needOf,
  heading = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
  readonly actions: WorkActions;
  /** What each of the person's waiting chats waits for (`needsByOpen`): an approval or an answer. */
  readonly needOf: ReadonlyMap<string, AgentNeed>;
  /** Whether the section heads the sidebar: with the count and what a project offers. */
  readonly heading?: boolean;
}) {
  const state = status.workspaces
    .find((workspace) => workspace.slug === project.workspace)
    ?.projects.find((candidate) => candidate.project.id === project.projectId);
  const checkout = state === undefined ? undefined : projectCheckout(state);
  const t3ProjectId = checkout?.projectId;
  const scope = { workspace: project.workspace, projectId: project.projectId };
  const opener = useOpenWorkspaceProject({ environmentId, ...scope, name: project.name });
  const { areas, total } = sidebarTasks(project);
  const areaNames = project.areas.flatMap((area) => (area.name === null ? [] : [area.name]));
  const slot = { environmentId, status, project, activeThread };
  const activeTask = activeThread?.startsWith(`task:${project.workspace}:${project.projectId}:`)
    ? activeThread.split(":").at(-1)
    : undefined;
  const opened = openAreasByDefault(areas, activeTask);
  const rows = (nested: ReadonlyArray<NestedRow<WorkTaskNode>>) =>
    nested.map(({ item: task, indent }) => (
      <TaskRow
        key={task.id}
        indent={indent}
        environmentId={environmentId}
        projectState={state}
        project={project}
        status={status}
        scope={scope}
        task={task}
        tasks={project.tasks}
        areas={areaNames}
        plugins={plugins}
        t3ProjectId={t3ProjectId}
        activeThread={activeThread}
        actions={actions}
        needOf={needOf}
      />
    ));

  return (
    <section aria-label={project.name} className="flex flex-col gap-2">
      <SignalTiles
        status={status}
        project={project}
        plugins={plugins}
        activeThread={activeThread}
        show={(signal) => !PLACED_SIGNALS.has(signal.id)}
      />
      {plugins.map(({ id, projectRows: Rows }) =>
        Rows === undefined ? null : <Rows key={id} {...slot} />,
      )}
      {heading ? (
        <div className="flex h-6 min-w-0 items-center gap-2 px-2">
          <h2 className="min-w-0 flex-1 truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Tasks
          </h2>
          {total === 0 ? null : <NavCount>{tasksCountLabel(total)}</NavCount>}
          <ProjectActions
            environmentId={environmentId}
            status={status}
            project={project}
            plugins={plugins}
            activeThread={activeThread}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        {checkout !== undefined && checkout.projectId === undefined ? (
          <NotOpenHere
            environmentId={environmentId}
            status={status}
            plugins={plugins}
            checkout={checkout}
            opening={opener.opening}
            onOpen={() => void opener.open()}
          />
        ) : null}
        {areas.length === 0 ? (
          <p className="px-2 py-0.5 text-xs text-muted-foreground">No tasks yet.</p>
        ) : null}
        {areas.map((area) => (
          <AreaGroup key={area.id} area={area} defaultOpen={opened.has(area.id)} rows={rows} />
        ))}
      </div>
    </section>
  );
}

/**
 * One area: its name and how much of it is done, folded by its chevron, then its open tasks and
 * its done ones behind a row. A project that names no area lists its tasks without a heading.
 */
function AreaGroup({
  area,
  defaultOpen,
  rows,
}: {
  readonly area: SidebarArea;
  readonly defaultOpen: boolean;
  readonly rows: (nested: ReadonlyArray<NestedRow<WorkTaskNode>>) => ReactNode;
}) {
  // Until the person folds it, an area follows the work: it opens when its task opens.
  const [choice, setChoice] = useState<boolean | null>(null);
  const [showDone, setShowDone] = useState(false);
  const open = choice ?? defaultOpen;
  const body = (
    <>
      <ul className="flex flex-col gap-0.5">{rows(area.open)}</ul>
      {area.finished.length === 0 ? null : (
        <button
          type="button"
          aria-expanded={showDone}
          className="w-fit rounded-sm px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => setShowDone((value) => !value)}
        >
          {showDone ? "Hide done" : `${area.finished.length} done`}
        </button>
      )}
      {showDone ? <ul className="flex flex-col gap-0.5">{rows(area.finished)}</ul> : null}
    </>
  );
  if (area.title === undefined) return body;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setChoice(!open)}
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-90")}
        />
        <span className="min-w-0 flex-1 truncate">{area.title}</span>
        <NavCount>
          {area.done}/{area.total}
        </NavCount>
      </button>
      {open ? <div className="pl-2">{body}</div> : null}
    </div>
  );
}

/**
 * A workspace project not open on this computer: clone and open it, or say
 * why that failed, with GitHub to connect when the account was the reason.
 */
function NotOpenHere({
  environmentId,
  status,
  plugins,
  checkout,
  opening,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly checkout: ProjectCheckout;
  readonly opening: boolean;
  readonly onOpen: () => void;
}) {
  const busy = opening || checkout.cloning;
  const failed = !busy && checkout.errors.length > 0;
  if (checkout.onlyUnsupported) {
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground">{checkout.unsupported.join(" ")}</p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 px-2 py-1">
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <span className={cn("min-w-0 flex-1", failed && "text-destructive")}>
          {failed
            ? checkout.errors.join(" ")
            : checkout.missing
              ? "Not on this computer yet."
              : "On this computer, not open yet."}
        </span>
        <Button size="xs" variant="outline" disabled={busy} onClick={onOpen}>
          {busy
            ? checkout.missing
              ? "Cloning…"
              : "Opening…"
            : failed
              ? "Try again"
              : checkout.missing
                ? "Clone & open"
                : "Open"}
        </Button>
      </div>
      {checkout.unsupported.length === 0 ? null : (
        <p className="text-xs text-muted-foreground">{checkout.unsupported.join(" ")}</p>
      )}
      {plugins.map(({ id, notOpenHere: Fix }) =>
        Fix === undefined ? null : (
          <Fix
            key={id}
            environmentId={environmentId}
            status={status}
            checkout={checkout}
            failed={failed}
            onRetry={onOpen}
          />
        ),
      )}
    </div>
  );
}
