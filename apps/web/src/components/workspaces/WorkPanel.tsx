import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { FolderIcon, KanbanSquareIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { Button } from "../ui/button";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { OverlapList } from "./Coordination";
import { NeedsYou } from "./NeedsYou";
import { ProjectHistory } from "./ProjectHistory";
import { ProjectSection } from "./ProjectSection";
import { projectSignals, SignalChips } from "./ProjectSignals";
import { ShareProject } from "./ShareProject";
import { ProjectMark } from "./signals";
import { selectLocalProjects } from "./localProjects.logic";
import { WorkHereContext } from "./marks";
import { useWorkData } from "./useWorkData";
import {
  ALL_PROJECTS,
  needProject,
  projectCounts,
  projectScopeKey,
  projectsByOpen,
  projectTaskCount,
  resolveScope,
} from "./workBoard.logic";
import { ColumnCountMarks, WorkScopePicker } from "./WorkScopePicker";
import { useWorkScope } from "./workScope";
import { openKey, type WorkProjectNode } from "./workTree.logic";
import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";
import type { PeerHubStatus } from "@t3tools/contracts";
import type { PeerWebPlugin } from "./slots.types";

/**
 * The sidebar's Work view. A project switcher on top keeps one project's work apart from the
 * others: with all projects it lists them as cards, with one it shows what holds now in that
 * project (its announcement, signals, Needs you and tasks by state) and, one click away, its
 * History. Needs you follows the same choice and shows only while something waits.
 */
export function WorkPanel() {
  const {
    environmentId,
    status,
    plugins,
    projects,
    tree,
    here,
    agents,
    needs,
    actions,
    activeThread,
  } = useWorkData();
  const navigate = useNavigate();
  const newThread = useNewThreadHandler();
  const { scratchWorkspaceRootFor } = useScratchProject();
  const [storedScope, setScope] = useWorkScope();
  const scope = resolveScope(storedScope, tree);
  const current = tree.find((project) => projectScopeKey(project) === scope);
  // The project whose History shows; choosing another project leaves it.
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const keepsHistory = plugins.some((plugin) => plugin.projectHistory !== undefined);
  const byOpen = useMemo(() => projectsByOpen(tree), [tree]);
  const inScope = (project: string | undefined) =>
    scope === ALL_PROJECTS || project === undefined || project === scope;
  const scopedNeeds = needs.filter((item) => inScope(needProject(item, byOpen)));
  const scopedAgents = agents.filter((agent) => inScope(byOpen.get(openKey(agent.open))));
  const projectOfOpen = (key: string) => {
    const project = tree.find((candidate) => projectScopeKey(candidate) === byOpen.get(key));
    return project === undefined
      ? undefined
      : { name: project.name, colorKey: projectScopeKey(project) };
  };
  const scopedStatus =
    status === null || current === undefined
      ? status
      : {
          ...status,
          coordination: {
            ...status.coordination,
            overlaps: status.coordination.overlaps.filter(
              (overlap) =>
                overlap.workspace === current.workspace && overlap.project === current.projectId,
            ),
          },
        };

  const sharedProjectIds = new Set(
    status?.workspaces.flatMap((workspace) =>
      workspace.projects.flatMap((project) =>
        project.repositories.flatMap((repository) =>
          repository.projectId ? [repository.projectId] : [],
        ),
      ),
    ) ?? [],
  );
  const localProjects = selectLocalProjects(
    projects,
    environmentId,
    environmentId === null ? null : scratchWorkspaceRootFor(environmentId),
    sharedProjectIds,
  );
  const showWorkspace = (status?.workspaces.length ?? 0) > 1;
  const signedIn = environmentId !== null && status !== null && status.signedIn;

  return (
    <WorkHereContext.Provider value={here}>
      <div className="flex flex-col gap-4 pb-6">
        {signedIn && tree.length > 0 ? (
          <div className="flex items-stretch gap-1.5">
            <div className="min-w-0 flex-1">
              <WorkScopePicker
                tree={tree}
                scope={scope}
                onChange={setScope}
                showWorkspace={showWorkspace}
                needs={needs}
              />
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    className="h-auto w-10 shrink-0"
                    aria-label="Open the Work board"
                    onClick={() => void navigate({ to: "/work" })}
                  />
                }
              >
                <KanbanSquareIcon className="size-4" />
              </TooltipTrigger>
              <TooltipPopup side="right">Work board</TooltipPopup>
            </Tooltip>
          </div>
        ) : null}
        {environmentId !== null &&
        status !== null &&
        current !== undefined &&
        historyOf === projectScopeKey(current) ? (
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
            {environmentId !== null && scopedStatus !== null && scopedStatus.signedIn ? (
              <OverlapList environmentId={environmentId} status={scopedStatus} />
            ) : null}
            {environmentId !== null && status !== null
              ? plugins
                  .filter((p) => p.workPanelPlace === "after-overlaps")
                  .map(({ id, workPanel: Section }) =>
                    Section ? (
                      <Section key={id} environmentId={environmentId} status={status} />
                    ) : null,
                  )
              : null}
            <NeedsYou
              environmentId={environmentId}
              status={status}
              plugins={plugins}
              agents={scopedAgents}
              items={scopedNeeds}
              activeThread={activeThread}
              onOpen={actions.open}
              projectOf={scope === ALL_PROJECTS ? projectOfOpen : undefined}
              showRunning={scope === ALL_PROJECTS}
            />
            {environmentId === null || status === null
              ? null
              : plugins
                  .filter((p) => p.workPanelPlace !== "after-overlaps")
                  .map(({ id, workPanel: Section }) =>
                    Section === undefined ? null : (
                      <Section key={id} environmentId={environmentId} status={status} />
                    ),
                  )}
            {environmentId === null || status === null ? (
              <p className="px-2 text-xs text-muted-foreground">Connecting…</p>
            ) : !status.signedIn ? (
              <NotSignedIn />
            ) : tree.length === 0 ? (
              <p className="px-2 text-xs leading-relaxed text-muted-foreground">
                {status.workspaces.length === 0
                  ? "Join or create a workspace in Settings → Workspaces to work with your team."
                  : "No team projects yet. Share one below, and everyone in the workspace can work on it."}
              </p>
            ) : current === undefined ? (
              <section aria-label="Projects" className="flex flex-col gap-1.5">
                <p className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Projects
                </p>
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
                showWorkspace={showWorkspace}
                activeThread={activeThread}
                actions={actions}
                onHistory={keepsHistory ? () => setHistoryOf(projectScopeKey(current)) : undefined}
              />
            )}
            {scope === ALL_PROJECTS && localProjects.length > 0 ? (
              <section aria-label="Local projects" className="flex flex-col gap-1">
                <div className="px-2">
                  <h2 className="text-xs font-medium text-secondary-label">Local projects</h2>
                  <p className="text-xs text-muted-foreground">Available on this computer</p>
                </div>
                {localProjects.map((project) => (
                  <Button
                    key={project.id}
                    variant="ghost-muted"
                    size="sm"
                    className="justify-start"
                    onClick={() =>
                      void newThread(scopeProjectRef(project.environmentId, project.id))
                    }
                  >
                    <FolderIcon className="size-3.5" />
                    <MiddleTruncate value={project.title} />
                  </Button>
                ))}
              </section>
            ) : null}
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
 * One project among all: its mark, how much of its work needs you, works or waits for review,
 * and its signals in their colors. Opening it scopes the Work views to it.
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
  const tasks = projectTaskCount(project);
  const signals = projectSignals(status, project, plugins);
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
            {showWorkspace ? `${project.workspaceName} · ` : ""}
            {tasks} {tasks === 1 ? "task" : "tasks"}
          </span>
        </span>
        <ColumnCountMarks counts={projectCounts(project, false, needs)} />
      </span>
      <span className="pl-7">
        <SignalChips signals={signals} />
      </span>
    </button>
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
        onClick={() => void navigate({ to: "/settings/workspaces" })}
      >
        Open Workspaces
      </Button>
    </div>
  );
}
