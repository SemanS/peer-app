import { deriveNeedsYou } from "@t3tools/client-runtime/peer/needs-you";
import { useAtomValue } from "@effect/atom-react";
import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useNavigate, useParams } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { deriveProviderEntriesByEnvironment } from "../../providerInstances";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironmentMachines, usePrimaryEnvironment } from "../../state/environments";
import { environmentServerConfigsAtom } from "../../state/server";
import { useUiStateStore } from "../../uiStateStore";
import { hasUnseenCompletion, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { useRelativeTimeTick } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { MiddleTruncate } from "../ui/middle-truncate";
import { OverlapList } from "./Coordination";
import { NeedsYou } from "./NeedsYou";
import { ProjectSection } from "./ProjectSection";
import { ShareProject } from "./ShareProject";
import { usePeerHubStatus } from "./WorkspaceAccess";
import { selectLocalProjects } from "./localProjects.logic";
import { type WorkHere, WorkHereContext } from "./marks";
import { usePeerPlugins } from "./slots";
import { canWatchThreads } from "./slots.logic";
import { useWorkActions } from "./useWorkActions";
import { activeAgents, buildWorkTree, taskLabel } from "./workTree.logic";

/**
 * The sidebar's Work view: what runs on this computer right now, then each
 * workspace project as Project → Area → Task → Threads, everyone's threads
 * with their person as metadata.
 */
export function WorkPanel() {
  const primary = usePrimaryEnvironment();
  const environmentId =
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null;
  const status = usePeerHubStatus(environmentId);
  const plugins = usePeerPlugins(status);
  const threads = useThreadShells();
  const projects = useProjects();
  const now = useRelativeTimeTick(30_000);
  const actions = useWorkActions(environmentId);
  const newThread = useNewThreadHandler();
  const { scratchWorkspaceRootFor } = useScratchProject();
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
  const activeThread = useParams({
    strict: false,
    select: (params) =>
      params.agentId
        ? `agent:${params.agentId}`
        : params.workspace && params.project && params.scope
          ? `context:${params.workspace}:${params.project}:${params.scope}`
          : params.workspace && params.project
            ? `knowledge:${params.workspace}:${params.project}`
            : params.workspace && params.environment && params.thread
              ? `observe:${params.workspace}:${params.environment}:${params.thread}`
              : params.environmentId && params.threadId
                ? `${params.environmentId}:${params.threadId}`
                : null,
  });
  const tree = useMemo(
    () =>
      status === null
        ? []
        : buildWorkTree({ status, localThreads: threads, now, watch: canWatchThreads(plugins) }),
    [now, plugins, status, threads],
  );
  const projectNames = useMemo(
    () => new Map(projects.map((p) => [`${p.environmentId}:${p.id}`, p.title] as const)),
    [projects],
  );
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const machines = useEnvironmentMachines();
  const here = useMemo<WorkHere>(
    () => ({
      providers:
        environmentId === null
          ? new Map()
          : (deriveProviderEntriesByEnvironment(
              [...serverConfigs].map(
                ([id, config]) => [id, config.providers, config.settings] as const,
              ),
            ).get(environmentId) ?? new Map()),
      label: primary?.label ?? null,
      machine: (environmentId === null ? undefined : machines.get(environmentId)) ?? "laptop",
    }),
    [environmentId, machines, primary?.label, serverConfigs],
  );
  const visited = useUiStateStore((state) => state.threadLastVisitedAtById);
  const unseen = useCallback(
    (thread: EnvironmentThreadShell) =>
      hasUnseenCompletion({
        ...thread,
        lastVisitedAt: resolveThreadLastVisitedAt(
          thread.lastVisitedAt,
          visited[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
        ),
      }),
    [visited],
  );
  const taskOf = useMemo(
    () =>
      new Map(
        tree.flatMap((project) =>
          project.areas.flatMap((area) =>
            area.tasks.flatMap((task) =>
              task.threads.map((thread) => [thread.key, taskLabel(task)] as const),
            ),
          ),
        ),
      ),
    [tree],
  );
  const agents = useMemo(
    () =>
      activeAgents({
        status,
        localThreads: threads,
        projectNames,
        localEnvironmentId: environmentId,
        unseen,
        taskOf,
      }),
    [environmentId, projectNames, status, taskOf, threads, unseen],
  );

  const needs = useMemo(
    () =>
      deriveNeedsYou({
        environments:
          environmentId === null
            ? []
            : [
                {
                  environmentId,
                  label: primary?.label ?? "This computer",
                  connected: true,
                  status,
                  threads,
                },
              ],
        now,
        unseen,
      }),
    [environmentId, primary?.label, status, threads, now, unseen],
  );
  return (
    <WorkHereContext.Provider value={here}>
      <div className="flex flex-col gap-4 pb-6">
        {environmentId !== null && status !== null && status.signedIn ? (
          <OverlapList environmentId={environmentId} status={status} />
        ) : null}
        {environmentId !== null && status !== null
          ? plugins
              .filter((p) => p.workPanelPlace === "after-overlaps")
              .map(({ id, workPanel: Section }) =>
                Section ? <Section key={id} environmentId={environmentId} status={status} /> : null,
              )
          : null}
        <NeedsYou
          environmentId={environmentId}
          status={status}
          plugins={plugins}
          agents={agents}
          items={needs}
          activeThread={activeThread}
          onOpen={actions.open}
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
        {localProjects.length > 0 ? (
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
                onClick={() => void newThread(scopeProjectRef(project.environmentId, project.id))}
              >
                <FolderIcon className="size-3.5" />
                <MiddleTruncate value={project.title} />
              </Button>
            ))}
          </section>
        ) : null}
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
        ) : (
          tree.map((project) => (
            <ProjectSection
              key={`${project.workspace}/${project.projectId}`}
              environmentId={environmentId}
              status={status}
              project={project}
              plugins={plugins}
              showWorkspace={status.workspaces.length > 1}
              activeThread={activeThread}
              actions={actions}
            />
          ))
        )}
        {environmentId !== null && status?.signedIn && status.workspaces.length > 0 ? (
          <ShareProject environmentId={environmentId} status={status} plugins={plugins} />
        ) : null}
      </div>
    </WorkHereContext.Provider>
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
