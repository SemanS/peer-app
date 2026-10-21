import { needsByOpen } from "@t3tools/client-runtime/peer/work";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { Button } from "../ui/button";
import { ProjectActions } from "./ProjectActions";
import { ProjectHistory } from "./ProjectHistory";
import { ProjectSection } from "./ProjectSection";
import { isLocalScope } from "./projectScope.logic";
import { ShareProject } from "./ShareProject";
import { TopNav } from "./SidebarNav";
import { useOpenScopedChats } from "./useOpenScopedChats";
import { sidebarNav } from "./sidebarNav.logic";
import { WorkSectionLabel, WorkHereContext } from "./marks";
import { ProjectMark, SignalCount } from "./signals";
import type { PeerWebPlugin } from "./slots.types";
import { useWorkData } from "./useWorkData";
import { WorkNoProjects } from "./WorkNoProjects";
import { ALL_PROJECTS, inScope, projectScopeKey } from "./workBoard.logic";
import type { WorkProjectNode } from "./workTree.logic";

/**
 * The sidebar's Tasks view, for the project the project button names (`scope`, which the root
 * checked against the projects there are). Search, Overview and Needs you lead; with all projects
 * the view groups tasks and navigation under expandable project headings; with one it shows its
 * Knowledge, Activity, Pull requests and Project settings. A project no workspace shares has no
 * team tasks, and the view says so.
 */
export function WorkPanel({ scope }: { readonly scope: string }) {
  const { environmentId, status, plugins, tree, here, needs, actions, activeThread } =
    useWorkData();
  const local = isLocalScope(scope);
  const current = tree.find((project) => projectScopeKey(project) === scope);
  // The project whose Activity shows; choosing another project leaves it.
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const keepsHistory = plugins.some((plugin) => plugin.projectHistory !== undefined);
  // What the rows count: the project in scope, or every project; a local project has no tasks.
  const counts = sidebarNav(
    tree.filter((project) => inScope(scope, project)),
    needs,
  );
  // What each of your waiting chats waits for, so a task's row tells an approval from an answer.
  const needOf = needsByOpen(needs);
  const signedIn = environmentId !== null && status !== null && status.signedIn;
  const historyProject = tree.find(
    (project) =>
      !local &&
      projectScopeKey(project) === historyOf &&
      (scope === ALL_PROJECTS || scope === historyOf),
  );
  const showingHistory = environmentId !== null && status !== null && historyProject !== undefined;

  return (
    <WorkHereContext.Provider value={here}>
      <div className="flex flex-col gap-5 pb-6">
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
            project={historyProject}
            plugins={plugins}
            activeThread={activeThread}
            onBack={() => setHistoryOf(null)}
          />
        ) : (
          <>
            {signedIn && tree.length > 0 ? (
              <TopNav needs={counts.needs} projectTasks={current !== undefined} />
            ) : null}
            {environmentId === null || status === null ? null : (
              <PluginSections environmentId={environmentId} status={status} plugins={plugins} />
            )}
            {environmentId === null || status === null ? (
              <p className="px-2 text-xs text-muted-foreground">Connecting…</p>
            ) : !status.signedIn ? (
              <NotSignedIn />
            ) : local ? (
              <LocalProjectNote />
            ) : current === undefined && scope !== ALL_PROJECTS ? (
              <p className="px-2 text-xs leading-relaxed text-muted-foreground">
                No team tasks yet for this project.
              </p>
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
            ) : current === undefined ? (
              <section aria-label="Projects" className="flex flex-col gap-1">
                <WorkSectionLabel>
                  Projects
                  <span className="font-normal tracking-normal normal-case tabular-nums">
                    {tree.length}
                  </span>
                </WorkSectionLabel>
                {tree.map((project) => (
                  <ProjectDisclosure
                    key={projectScopeKey(project)}
                    project={project}
                    needs={sidebarNav([project], needs).needs}
                  >
                    <ProjectSection
                      environmentId={environmentId}
                      status={status}
                      project={project}
                      plugins={plugins}
                      activeThread={activeThread}
                      actions={actions}
                      counts={sidebarNav([project], needs)}
                      needOf={needOf}
                      tasksNavigation={false}
                      onHistory={
                        keepsHistory ? () => setHistoryOf(projectScopeKey(project)) : undefined
                      }
                    />
                  </ProjectDisclosure>
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
  const openChats = useOpenScopedChats();
  const onWork = useLocation({ select: (location) => location.pathname === "/work" });
  if (onWork) return null;
  return (
    <div className="flex flex-col items-start gap-2 px-2 text-xs leading-relaxed text-muted-foreground">
      <p>This project is not shared with a workspace, so it has no team tasks.</p>
      <Button size="xs" variant="outline" onClick={openChats}>
        Show its chats
      </Button>
    </div>
  );
}

function ProjectDisclosure({
  project,
  children,
  needs,
}: {
  readonly project: WorkProjectNode;
  readonly children: ReactNode;
  readonly needs: number | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="group/project" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-md px-2 py-2 text-sm font-medium outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <ProjectMark name={project.name} colorKey={projectScopeKey(project)} />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {needs === null ? null : <SignalCount tone="needs" count={needs} label="need you" />}
        <span aria-hidden className="text-muted-foreground group-open/project:rotate-90">
          ›
        </span>
      </summary>
      {open ? <div className="pl-2">{children}</div> : null}
    </details>
  );
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
