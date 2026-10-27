import { useLocation, useNavigate } from "@tanstack/react-router";
import { FileTextIcon } from "lucide-react";
import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";
import { SidebarMenu, useSidebar } from "../ui/sidebar";
import { NavRow, TopNav } from "./SidebarNav";
import { projectSignals } from "./ProjectSignals";
import { chatScopeKeys, isLocalScope, type ResolvedProjectScope } from "./projectScope.logic";
import { sidebarNav } from "./sidebarNav.logic";
import { usePeerHubStatus } from "./WorkspaceAccess";
import { useWorkData } from "./useWorkData";
import { ALL_PROJECTS, inScope, projectScopeKey } from "./workBoard.logic";

export function StableWorkNavigation({ scope }: { readonly scope: ResolvedProjectScope }) {
  const { status: primaryStatus, threads, tree, plugins, needs, activeThread } = useWorkData();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = useLocation({ select: (location) => location.pathname });
  const project = tree.find((project) => projectScopeKey(project) === scope.scope);
  const local = isLocalScope(scope.scope);
  const targetEnvironment = local ? scope.refs?.[0]?.environmentId : undefined;
  const targetStatus = usePeerHubStatus(targetEnvironment ?? null);
  const status = targetEnvironment === undefined ? primaryStatus : targetStatus;
  const keys = chatScopeKeys(scope.refs);
  const localProjects = [
    ...new Map(
      (
        status?.coordination.local?.projects?.filter(
          (entry) => keys === null || keys.has(`${status.environmentId}:${entry.projectId}`),
        ) ?? []
      ).map((entry) => [entry.id, entry]),
    ).values(),
  ];
  const localIds = new Set(localProjects.map((entry) => entry.id));
  const count = local
    ? threads.filter(
        (thread) =>
          keys?.has(`${thread.environmentId}:${thread.projectId}`) &&
          thread.deletedAt === null &&
          thread.archivedAt === null &&
          thread.lineage.relationshipToParent !== "subagent" &&
          (thread.hasPendingApprovals || thread.hasPendingUserInput),
      ).length +
      (status?.coordination.overlaps.filter(
        (overlap) => overlap.state === "open" && localIds.has(overlap.project),
      ).length ?? 0)
    : scope.scope === ALL_PROJECTS
      ? needs.length
      : sidebarNav(
          tree.filter((item) => inScope(scope.scope, item)),
          needs,
        ).needs;
  const core =
    status === null || project === undefined
      ? []
      : projectSignals(status, project, plugins).filter(
          (signal) => signal.id === "knowledge" || signal.id === "team",
        );
  const open = (action: () => unknown) => {
    if (isMobile) setOpenMobile(false);
    void action();
  };
  return (
    <div className="flex flex-col gap-1">
      <TopNav needs={count} scope={scope.scope} />
      {core.length === 0 && localProjects.length !== 1 ? null : (
        <SidebarMenu aria-label="Project destinations">
          {core.map((signal) => (
            <NavRow
              key={signal.id}
              icon={signal.icon}
              label={signal.label}
              active={activeThread === `${signal.id}:${project!.workspace}:${project!.projectId}`}
              onClick={() => open(() => signal.open?.(navigate))}
            />
          ))}
          {local && localProjects.length === 1 ? (
            <NavRow
              icon={FileTextIcon}
              label="Shared context"
              active={pathname.startsWith("/context/")}
              onClick={() =>
                open(() =>
                  navigate({
                    to: "/context/$workspace/$project/$scope",
                    params: {
                      workspace: PEER_LOCAL_WORKSPACE,
                      project: localProjects[0]!.id,
                      scope: "project-aggregate",
                    },
                    search: { environmentId: targetEnvironment },
                  }),
                )
              }
            />
          ) : null}
        </SidebarMenu>
      )}
    </div>
  );
}
