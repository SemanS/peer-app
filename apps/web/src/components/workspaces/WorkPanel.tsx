import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";
import { needsByOpen } from "@t3tools/client-runtime/peer/work";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { Button } from "../ui/button";
import { ProjectActions } from "./ProjectActions";
import { ProjectHistory } from "./ProjectHistory";
import { ProjectSection } from "./ProjectSection";
import { projectSignals, SignalChips } from "./ProjectSignals";
import { isLocalScope } from "./projectScope.logic";
import { ShareProject } from "./ShareProject";
import { TopNav } from "./SidebarNav";
import { useSidebarView } from "./SidebarViewSwitch";
import {
  sidebarNav,
  activeTaskCount,
  activeTasksText,
  sidebarNeedsCount,
} from "./sidebarNav.logic";
import { WorkSectionLabel, WorkHereContext } from "./marks";
import { ProjectMark, SignalCount } from "./signals";
import type { PeerWebPlugin } from "./slots.types";
import { useWorkData } from "./useWorkData";
import { WorkNoProjects } from "./WorkNoProjects";
import { ALL_PROJECTS, projectScopeKey, resolveScope } from "./workBoard.logic";
import { useWorkScope } from "./workScope";
import type { WorkProjectNode } from "./workTree.logic";

/**
 * The sidebar's Tasks view, for the project the project button names (`scope`, which the root
 * checked against the projects there are). Search, Overview and Needs you lead; with all projects
 * the view lists them as cards, with one it shows the project's tasks by area and, below them, its
 * Knowledge, Activity, Pull requests and Project settings. A project no workspace shares has no
 * team tasks, and the view says so.
 */
export function WorkPanel({ scope: chosen }: { readonly scope: string }) {
  const { environmentId, status, plugins, tree, here, needs, actions, activeThread } =
    useWorkData();
  const [, setScope] = useWorkScope();
  const local = isLocalScope(chosen);
  const scope = local ? ALL_PROJECTS : resolveScope(chosen, tree);
  const current = tree.find((project) => projectScopeKey(project) === scope);
  // The project whose Activity shows; choosing another project leaves it.
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const keepsHistory = plugins.some((plugin) => plugin.projectHistory !== undefined);
  // What the rows count: the project in scope, or every project; a local project has no tasks.
  const counts = sidebarNav(local ? [] : current === undefined ? tree : [current], needs);
  // What each of your waiting chats waits for, so a task's row tells an approval from an answer.
  const needOf = useMemo(() => needsByOpen(needs), [needs]);
  const showWorkspace = (status?.workspaces.length ?? 0) > 1;
  // How many projects something waits on you in, for the Projects heading.
  const waiting = tree.filter((project) => sidebarNeedsCount([project], needs) > 0).length;
  const signedIn = environmentId !== null && status !== null && status.signedIn;
  const showingHistory =
    environmentId !== null &&
    status !== null &&
    current !== undefined &&
    historyOf === projectScopeKey(current);

  return (
    <WorkHereContext.Provider value={here}>
      <div className="flex flex-col gap-3 pb-6">
        {environmentId !== null && status !== null && current !== undefined && !showingHistory ? (
          <ProjectActions
            key={projectScopeKey(current)}
            environmentId={environmentId}
            status={status}
            project={current}
            plugins={plugins}
            activeThread={activeThread}
          />
        ) : null}
        {showingHistory ? (
          <ProjectHistory
            environmentId={environmentId}
            status={status}
            project={current}
            plugins={plugins}
            activeThread={activeThread}
            onBack={() => setHistoryOf(null)}
          />
        ) : (
          <>
            {signedIn && tree.length > 0 ? <TopNav needs={counts.needs} /> : null}
            {environmentId === null || status === null ? null : (
              <PluginSections environmentId={environmentId} status={status} plugins={plugins} />
            )}
            {environmentId === null || status === null ? (
              <p className="px-2 text-xs text-muted-foreground">Connecting…</p>
            ) : !status.signedIn ? (
              <NotSignedIn />
            ) : tree.length === 0 ? (
              status.workspaces.length === 0 ? (
                <p className="px-2 text-xs leading-relaxed text-muted-foreground">
                  Join or create a workspace in Settings → Peer to work with your team.
                </p>
              ) : (
                <WorkNoProjects
                  environmentId={environmentId}
                  status={status}
                  plugins={plugins}
                  fallback={
                    <p className="px-2 text-xs leading-relaxed text-muted-foreground">
                      No team projects yet. Share one below, and everyone in the workspace can work
                      on it.
                    </p>
                  }
                />
              )
            ) : local ? (
              <LocalProjectNote />
            ) : current === undefined ? (
              <section aria-label="Projects" className="flex flex-col gap-1.5">
                <WorkSectionLabel>
                  Projects
                  <span className="font-normal tracking-normal normal-case tabular-nums">
                    {tree.length}
                    {waiting > 0 ? ` · ${waiting} need you` : ""}
                  </span>
                </WorkSectionLabel>
                {tree.map((project) => (
                  <ProjectCard
                    key={projectScopeKey(project)}
                    status={status}
                    project={project}
                    plugins={plugins}
                    needs={needs}
                    showWorkspace={showWorkspace}
                    onOpen={() => setScope(projectScopeKey(project))}
                  />
                ))}
              </section>
            ) : (
              <ProjectSection
                key={projectScopeKey(current)}
                environmentId={environmentId}
                status={status}
                project={current}
                plugins={plugins}
                activeThread={activeThread}
                actions={actions}
                counts={counts}
                needOf={needOf}
                onHistory={keepsHistory ? () => setHistoryOf(projectScopeKey(current)) : undefined}
              />
            )}
            {environmentId !== null && status?.signedIn && status.workspaces.length > 0 ? (
              <ShareProject environmentId={environmentId} status={status} plugins={plugins} />
            ) : null}
          </>
        )}
      </div>
    </WorkHereContext.Provider>
  );
}

/**
 * What plugins show above the project: the things that wait on the person which the board does not
 * list (tools to trust), and sections such as held resources. Each renders nothing while it has
 * nothing to say. Team requests are cards on the board, not here.
 */
function PluginSections({
  environmentId,
  status,
  plugins,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
}) {
  return (
    <>
      {plugins
        .filter((plugin) => plugin.id !== "requests")
        .map(({ id, needsYou }) =>
          needsYou?.Component === undefined ? null : (
            <needsYou.Component
              key={id}
              environmentId={environmentId}
              status={status}
              plugins={plugins}
            />
          ),
        )}
      {plugins
        .filter((plugin) => plugin.workPanelPlace === "after-overlaps")
        .map(({ id, workPanel: Section }) =>
          Section === undefined ? null : (
            <Section key={id} environmentId={environmentId} status={status} />
          ),
        )}
      {plugins
        .filter((plugin) => plugin.workPanelPlace !== "after-overlaps")
        .map(({ id, workPanel: Section }) =>
          Section === undefined ? null : (
            <Section key={id} environmentId={environmentId} status={status} />
          ),
        )}
    </>
  );
}

/** What the Tasks view says over a project that no workspace shares. */
function LocalProjectNote() {
  const [, setView] = useSidebarView();
  return (
    <div className="flex flex-col items-start gap-2 px-2 text-xs leading-relaxed text-muted-foreground">
      <p>This project is not shared with a workspace, so it has no team tasks.</p>
      <Button size="xs" variant="outline" onClick={() => setView("threads")}>
        Show its chats
      </Button>
    </div>
  );
}

/**
 * One project among all: its mark, how many tasks are active, how many wait on you, and its
 * signals in their colors. Opening it scopes the Tasks and Chats views to it.
 */
function ProjectCard({
  status,
  project,
  plugins,
  needs,
  showWorkspace,
  onOpen,
}: {
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly needs: ReadonlyArray<NeedsYouItem>;
  readonly showWorkspace: boolean;
  readonly onOpen: () => void;
}) {
  const signals = projectSignals(status, project, plugins);
  const client = projectClient(status, project);
  return (
    <button
      type="button"
      className="flex w-full min-w-0 flex-col gap-1.5 rounded-lg border border-sidebar-border bg-sidebar-control-surface px-2.5 py-2 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <ProjectMark name={project.name} colorKey={projectScopeKey(project)} className="size-5" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-sidebar-foreground">
            {project.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {[
              showWorkspace ? project.workspaceName : undefined,
              client,
              activeTasksText(activeTaskCount(project)),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <SignalCount tone="needs" count={sidebarNeedsCount([project], needs)} label="need you" />
        </span>
      </span>
      <span className="pl-7">
        <SignalChips signals={signals} />
      </span>
    </button>
  );
}

/** A project's client, as its workspace configuration names it (e.g. Turnkey). */
function projectClient(status: PeerHubStatus | null, project: WorkProjectNode): string | undefined {
  return status?.workspaces
    .find((workspace) => workspace.slug === project.workspace)
    ?.projects.find((state) => state.project.id === project.projectId)?.project.client;
}

function NotSignedIn() {
  const navigate = useNavigate();
  return (
    <div className="px-2 text-xs leading-relaxed text-muted-foreground">
      <p>Sign in with your work email to see your team’s projects, tasks and agents.</p>
      <Button
        className="mt-2"
        size="xs"
        variant="outline"
        onClick={() => void navigate({ to: "/settings/peer" })}
      >
        Open Peer settings
      </Button>
    </div>
  );
}
