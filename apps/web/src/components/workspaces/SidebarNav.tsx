import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { usePullRequestsSupported } from "../../state/environments";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { projectCheckout } from "./useOpenWorkspaceProject";
import type { WorkProjectNode } from "./workTree.logic";

/** An icon as the navigation draws it: lucide's, or the pull request glyph. */
type NavIcon = LucideIcon | ComponentType<{ readonly className?: string }>;

/**
 * One row of the sidebar's navigation: its icon, its name, and what follows (a count, a shortcut).
 * `active` marks the screen the main area shows; `expanded` makes the row a disclosure.
 */
function NavRow({
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

/** The project's pull requests, T3 Code's own page, where the environment supports them. */
export function ProjectPullRequestsNav({
  environmentId,
  status,
  project,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
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
  if (!pullRequestsSupported) return null;
  return (
    <SidebarMenu aria-label={`Pull requests of ${project.name}`}>
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
    </SidebarMenu>
  );
}
