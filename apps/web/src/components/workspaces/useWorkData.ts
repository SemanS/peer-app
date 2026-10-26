import { deriveNeedsYou } from "@t3tools/client-runtime/peer/needs-you";
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useLocation, useParams } from "@tanstack/react-router";

import { deriveProviderEntriesByEnvironment } from "../../providerInstances";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironmentMachines, usePrimaryEnvironment } from "../../state/environments";
import { environmentServerConfigsAtom } from "../../state/server";
import { useUiStateStore } from "../../uiStateStore";
import { hasUnseenCompletion, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { useRelativeTimeTick } from "../settings/settingsLayout";
import { activeRouteKey } from "./sidebarRoutes.logic";
import type { WorkHere } from "./marks";
import { usePeerPlugins } from "./slots";
import { canWatchThreads } from "./slots.logic";
import { useWorkActions } from "./useWorkActions";
import { useOrganizationStatus } from "./ActiveOrganization";
import { usePeerHubStatus } from "./WorkspaceAccess";
import { activeAgents, buildWorkTree, taskLabel } from "./workTree.logic";

/**
 * What the Work views read: this computer's Hub status and active plugins, the team's work as a
 * tree, what runs here and what waits on the person. The sidebar and the Work board share it.
 */
export function useWorkData() {
  const primary = usePrimaryEnvironment();
  const environmentId =
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null;
  // Work is the active organization's, where the person is in several.
  const status = useOrganizationStatus(usePeerHubStatus(environmentId));
  const plugins = usePeerPlugins(status);
  const threads = useThreadShells();
  const projects = useProjects();
  const now = useRelativeTimeTick(30_000);
  const actions = useWorkActions(environmentId);
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeThread = useParams({
    strict: false,
    select: (params) => activeRouteKey(pathname, params),
  });
  const tree =
    status === null
      ? []
      : buildWorkTree({ status, localThreads: threads, now, watch: canWatchThreads(plugins) });
  const projectNames = new Map(
    projects.map((p) => [`${p.environmentId}:${p.id}`, p.title] as const),
  );
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const machines = useEnvironmentMachines();
  const here: WorkHere = {
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
  };
  const visited = useUiStateStore((state) => state.threadLastVisitedAtById);
  const unseen = (thread: EnvironmentThreadShell) =>
    hasUnseenCompletion({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        visited[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
    });
  const taskOf = new Map(
    tree.flatMap((project) =>
      project.areas.flatMap((area) =>
        area.tasks.flatMap((task) =>
          task.threads.map((thread) => [thread.key, taskLabel(task)] as const),
        ),
      ),
    ),
  );
  const agents = activeAgents({
    status,
    localThreads: threads,
    projectNames,
    localEnvironmentId: environmentId,
    unseen,
    taskOf,
  });
  const needs = deriveNeedsYou({
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
  });
  return {
    environmentId,
    status,
    plugins,
    threads,
    projects,
    tree,
    here,
    agents,
    needs,
    actions,
    activeThread,
    now,
  };
}
