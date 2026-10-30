import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { FileTextIcon, LightbulbIcon, type LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { usePullRequestsSupported } from "../../state/environments";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { projectSignals } from "./ProjectSignals";
import { pluginNavRows } from "./sidebarNav.logic";
import type { PeerWebPlugin } from "./slots.types";
import { projectCheckout } from "./useOpenWorkspaceProject";
import type { WorkProjectNode } from "./workTree.logic";

/** An icon as the navigation draws it: lucide's, or the pull request glyph. */
type NavIcon = LucideIcon | ComponentType<{ readonly className?: string }>;

/**
 * One row of the sidebar's navigation: its icon, its name, and what follows (a count, a shortcut).
 * `active` marks the screen the main area shows; `expanded` makes the row a disclosure.
 */
export function NavRow({
  icon: Icon,
  label,
  trailing,
  active = false,
  expanded,
  onClick,
}: {
  readonly icon: NavIcon;
  readonly label: string;
  readonly trailing?: ReactNode;
  readonly active?: boolean;
  readonly expanded?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        aria-current={active ? "page" : undefined}
        {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
        onClick={onClick}
      >
        <Icon aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** A count after a row's name: "7 open", "2 done". */
export function NavCount({ children }: { readonly children: ReactNode }) {
  return <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{children}</span>;
}

/** Leaves the sidebar's drawer behind on a phone once a row took the person elsewhere. */
function useGo() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  return {
    navigate,
    /** Runs a navigation, and closes the drawer on a phone. */
    go: (to: () => unknown) => {
      if (isMobile) setOpenMobile(false);
      void to();
    },
  };
}

/**
 * The Knowledge tab of one project: what holds beyond a single task. What a task learned shows on
 * that task; here is the project's saved knowledge, its current context and its memory.
 */
export function ProjectKnowledgeNav({
  status,
  project,
  plugins,
  activeThread,
  sharedContext,
}: {
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
  readonly sharedContext: boolean;
}) {
  const { navigate, go } = useGo();
  const signals = projectSignals(status, project, plugins);
  const knowledge = signals.find((signal) => signal.id === "knowledge");
  const memory = signals.find((signal) => signal.id === "memory");
  const contextOpen = `context:${project.workspace}:${project.projectId}:project`;
  return (
    <SidebarMenu aria-label={`Knowledge of ${project.name}`}>
      {knowledge === undefined ? null : (
        <NavRow
          icon={LightbulbIcon}
          label="Saved knowledge"
          active={activeThread === `knowledge:${project.workspace}:${project.projectId}`}
          trailing={
            knowledge.count === null || knowledge.count <= 0 ? undefined : (
              <Badge variant="knowledge" size="sm">
                {knowledge.chip?.(knowledge.count) ?? `${knowledge.count}`}
              </Badge>
            )
          }
          onClick={() => go(() => knowledge.open?.(navigate))}
        />
      )}
      {!sharedContext ? null : (
        <NavRow
          icon={FileTextIcon}
          label="Project context"
          active={activeThread === contextOpen}
          onClick={() =>
            go(() =>
              navigate({
                to: "/context/$workspace/$project/$scope",
                params: {
                  workspace: project.workspace,
                  project: project.projectId,
                  scope: "project",
                },
              }),
            )
          }
        />
      )}
      {memory === undefined ? null : (
        <NavRow
          icon={memory.icon}
          label={memory.label}
          onClick={() => go(() => memory.open?.(navigate))}
        />
      )}
    </SidebarMenu>
  );
}

/** The Activity tab's rows: where work moves as changes and pull requests. */
export function ProjectActivityNav({
  environmentId,
  status,
  project,
  plugins,
  activeThread,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
}) {
  const { navigate, go } = useGo();
  const pullRequestsSupported = usePullRequestsSupported();
  const onPullRequests = useLocation({
    select: (location) => location.pathname === "/pull-requests",
  });
  const state = status.workspaces
    .find((workspace) => workspace.slug === project.workspace)
    ?.projects.find((candidate) => candidate.project.id === project.projectId);
  const t3ProjectId = state === undefined ? undefined : projectCheckout(state).projectId;
  return (
    <SidebarMenu aria-label={`Activity of ${project.name}`}>
      {pluginNavRows(projectSignals(status, project, plugins)).map(({ id, row }) => (
        <NavRow
          key={id}
          icon={row.icon}
          label={row.label}
          active={row.active?.(activeThread) ?? false}
          trailing={
            row.count === undefined || row.count === null || row.count <= 0 ? undefined : (
              <NavCount>{row.count}</NavCount>
            )
          }
          onClick={() => go(() => row.open(navigate))}
        />
      ))}
      {pullRequestsSupported ? (
        <NavRow
          icon={PullRequestGlyph.pullRequest}
          label="Pull requests"
          active={onPullRequests}
          onClick={() =>
            go(() => {
              // Scoped to the project's repository where it is open on this computer.
              const {
                environmentId: _environment,
                projectId: _project,
                ...list
              } = readPullRequestListPreferences();
              return navigate({
                to: "/pull-requests",
                search: {
                  ...list,
                  ...(t3ProjectId === undefined ? {} : { environmentId, projectId: t3ProjectId }),
                },
              });
            })
          }
        />
      ) : null}
    </SidebarMenu>
  );
}
