import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { FolderIcon, KanbanSquareIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { Button } from "../ui/button";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { NeedsYou } from "./NeedsYou";
import { ProjectHistory } from "./ProjectHistory";
import { ProjectSection } from "./ProjectSection";
import { projectSignals, SignalChips } from "./ProjectSignals";
import { ShareProject } from "./ShareProject";
import { WorkSectionLabel } from "./marks";
import { ProjectMark } from "./signals";
import { WorkNoProjects } from "./WorkNoProjects";
import { selectLocalProjects } from "./localProjects.logic";
import { WorkHereContext } from "./marks";
import { useWorkData } from "./useWorkData";
import {
  ALL_PROJECTS,
  boardCards,
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
import { needsByOpen } from "@t3tools/client-runtime/peer/work";
import type { PeerHubStatus } from "@t3tools/contracts";
import type { PeerWebPlugin } from "./slots.types";

/**
 * The sidebar's Work view. A project switcher on top keeps one project's work apart from the
 * others. Needs you comes first, as the Work board's column lists it for the same projects, and
 * shows only while something waits. With all projects the view lists them as cards; with one it
 * shows what holds now in that project (its signals as tiles, its announcement, its tasks by
 * area) and, one click away, its History.
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
  const scopedAgents = agents.filter((agent) => inScope(byOpen.get(openKey(agent.open))));
  // What each of your waiting chats waits for, so a task's row tells an approval from an answer.
  const needOf = useMemo(() => needsByOpen(needs), [needs]);
  // The same cards as the Work board's Needs you column for the same projects.
  const needCards = useMemo(
    () =>
      boardCards(tree, { scope, mine: false, query: "", needs }).filter(
        (card) => card.column === "needs",
      ),
    [needs, scope, tree],
  );

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
  const clients = useMemo(
    () =>
      new Map(
        tree.flatMap((project) => {
          const client = projectClient(status, project);
          return client === undefined ? [] : [[projectScopeKey(project), client] as const];
        }),
      ),
    [status, tree],
  );
  // How many projects something waits on you in, for the Projects heading.
  const waiting = tree.filter((project) => projectCounts(project, false, needs).needs > 0).length;
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
                clients={clients}
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
              cards={needCards}
              activeThread={activeThread}
              onOpen={actions.open}
              showProject={scope === ALL_PROJECTS}
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
                showWorkspace={showWorkspace}
                activeThread={activeThread}
                actions={actions}
                needOf={needOf}
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
              `${tasks} ${tasks === 1 ? "task" : "tasks"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
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
