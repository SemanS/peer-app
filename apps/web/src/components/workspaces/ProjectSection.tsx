import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, CircleCheckIcon, ListChecksIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { SidebarMenu, useSidebar } from "../ui/sidebar";
import { SignalTiles } from "./ProjectSignals";
import { NavCount, NavRow, ProjectNav } from "./SidebarNav";
import type { SidebarNavCounts } from "./sidebarNav.logic";
import { TaskRow } from "./TaskRow";
import type { PeerWebPlugin } from "./slots.types";
import { groupTasks, type TaskGroupNode } from "./workGroups.logic";
import {
  projectCheckout,
  type ProjectCheckout,
  useOpenWorkspaceProject,
} from "./useOpenWorkspaceProject";
import type { WorkActions } from "./useWorkActions";
import { useWorkLayout } from "./workScope";
import type { AgentNeed, WorkProjectNode } from "./workTree.logic";

/**
 * The open project in the Tasks view: what holds now (its signals, its announcement), its tasks
 * by area under a Tasks row, its done tasks folded under Done, and below them its Knowledge,
 * Activity, Pull requests and Project settings. Chats on no task are in the Chats view.
 */
export function ProjectSection({
  environmentId,
  status,
  project,
  plugins,
  activeThread,
  actions,
  counts,
  needOf,
  onHistory,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
  readonly actions: WorkActions;
  readonly counts: SidebarNavCounts;
  /** What each of the person's waiting chats waits for (`needsByOpen`): an approval or an answer. */
  readonly needOf: ReadonlyMap<string, AgentNeed>;
  /** Opens the project's Activity; absent while no plugin keeps one. */
  readonly onHistory: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const [layout, setLayout] = useWorkLayout();
  const onList = useLocation({
    select: (location) => location.pathname === "/work" && layout === "list",
  });
  const { isMobile, setOpenMobile } = useSidebar();
  const state = status.workspaces
    .find((workspace) => workspace.slug === project.workspace)
    ?.projects.find((candidate) => candidate.project.id === project.projectId);
  const checkout = state === undefined ? undefined : projectCheckout(state);
  const t3ProjectId = checkout?.projectId;
  const scope = { workspace: project.workspace, projectId: project.projectId };
  const opener = useOpenWorkspaceProject({ environmentId, ...scope, name: project.name });
  const groups = groupTasks(project);
  const areaNames = project.areas.flatMap((area) => (area.name === null ? [] : [area.name]));
  const active = groups.filter((group) => !group.done);
  const done = groups.find((group) => group.done);
  const slot = { environmentId, status, project, activeThread };
  const rows = (group: TaskGroupNode) =>
    group.tasks.map((task) => (
      <TaskRow
        key={task.id}
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
      {/* What holds now: the signals that open a page as tiles (Knowledge has its own row below),
          then what plugins show in place. */}
      <SignalTiles
        status={status}
        project={project}
        plugins={plugins.filter((plugin) => plugin.id !== "knowledge")}
        activeThread={activeThread}
      />
      {plugins.map(({ id, projectRows: Rows }) =>
        Rows === undefined ? null : <Rows key={id} {...slot} />,
      )}
      <div className="flex flex-col gap-0.5">
        <SidebarMenu aria-label="Tasks">
          <NavRow
            icon={ListChecksIcon}
            label="Tasks"
            active={onList}
            trailing={
              counts.active === null ? undefined : <NavCount>{counts.active} active</NavCount>
            }
            onClick={() => {
              // The list is the Work screen's other layout; the Overview row keeps the board.
              setLayout("list");
              if (isMobile) setOpenMobile(false);
              void navigate({ to: "/work" });
            }}
          />
        </SidebarMenu>
        <div className="flex flex-col gap-1 pl-1">
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
          {active.length === 0 ? (
            <p className="px-2 py-0.5 text-xs text-muted-foreground">
              {done === undefined ? "No tasks yet." : "No active tasks."}
            </p>
          ) : null}
          {active.map((group) => (
            <AreaGroup key={group.id} group={group}>
              {rows(group)}
            </AreaGroup>
          ))}
        </div>
        {done === undefined ? null : <DoneGroup group={done}>{rows(done)}</DoneGroup>}
      </div>
      <div className="px-2">
        <Separator />
      </div>
      <ProjectNav
        environmentId={environmentId}
        status={status}
        project={project}
        plugins={plugins}
        activeThread={activeThread}
        sharedContext={counts.sharedContext}
        onHistory={onHistory}
      />
    </section>
  );
}

/**
 * One area of a project's open tasks: its name and count over its tasks, folded by its chevron.
 * A project that names no area lists its tasks without a heading.
 */
function AreaGroup({
  group,
  children,
}: {
  readonly group: TaskGroupNode;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (group.title === undefined) {
    return <ul className="flex flex-col gap-0.5">{children}</ul>;
  }
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-xs font-semibold text-secondary-label outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRightIcon aria-hidden className={cn("size-3 shrink-0", open && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate">{group.title}</span>
        <span className="font-normal text-muted-foreground tabular-nums">{group.tasks.length}</span>
      </button>
      {open ? <ul className="flex flex-col gap-0.5">{children}</ul> : null}
    </div>
  );
}

/** The done tasks: a Done row with their count, folded until opened. */
function DoneGroup({
  group,
  children,
}: {
  readonly group: TaskGroupNode;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <SidebarMenu aria-label="Done tasks">
        <NavRow
          icon={CircleCheckIcon}
          label="Done"
          expanded={open}
          trailing={<NavCount>{group.tasks.length}</NavCount>}
          onClick={() => setOpen((value) => !value)}
        />
      </SidebarMenu>
      {open ? <ul className="flex flex-col gap-0.5 pl-1">{children}</ul> : null}
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
