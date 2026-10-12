import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ActivityIcon,
  FileTextIcon,
  InboxIcon,
  LayoutGridIcon,
  LightbulbIcon,
  type LucideIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { shortcutLabelForCommand } from "../../keybindings";
import { usePullRequestsSupported } from "../../state/environments";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { Kbd } from "../ui/kbd";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { projectSignals } from "./ProjectSignals";
import { DEFAULT_PROJECT_TAB } from "./settings/peerSettings.logic";
import { useOpenPeerSettings } from "./settings/peerSettingsLinks";
import { SignalCount } from "./signals";
import type { PeerWebPlugin } from "./slots.types";
import { projectCheckout } from "./useOpenWorkspaceProject";
import { useWorkLayout } from "./workScope";
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

/** A count after a row's name: "7 active", "2 done". */
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

/** Search, Overview and Needs you: the rows that hold for every project. */
export function TopNav({ needs }: { readonly needs: number | null }) {
  const { navigate, go } = useGo();
  const [layout, setLayout] = useWorkLayout();
  const onWork = useLocation({ select: (location) => location.pathname === "/work" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcut = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  return (
    <SidebarMenu aria-label="Peer navigation">
      <NavRow
        icon={SearchIcon}
        label="Search"
        trailing={shortcut === null ? undefined : <Kbd>{shortcut}</Kbd>}
        onClick={() => openCommandPalette()}
      />
      <NavRow
        icon={LayoutGridIcon}
        label="Overview"
        active={onWork && layout === "board"}
        onClick={() =>
          go(() => {
            // The Overview is the board; the Tasks row below is the same screen as a list.
            setLayout("board");
            return navigate({ to: "/work" });
          })
        }
      />
      <NavRow
        icon={InboxIcon}
        label="Needs you"
        trailing={
          needs === null ? undefined : <SignalCount tone="needs" count={needs} label="need you" />
        }
        onClick={() =>
          go(() => {
            setLayout("board");
            return navigate({ to: "/work" });
          })
        }
      />
    </SidebarMenu>
  );
}

/**
 * The rows under a project's tasks: its Knowledge (and the shared context beside it, once one was
 * written), Activity, Pull requests and Project settings. A plugin that is off takes its rows away.
 */
export function ProjectNav({
  environmentId,
  status,
  project,
  plugins,
  activeThread,
  sharedContext,
  onHistory,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly project: WorkProjectNode;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly activeThread: string | null;
  readonly sharedContext: boolean;
  /** Opens the project's Activity; absent while no plugin keeps one. */
  readonly onHistory: (() => void) | undefined;
}) {
  const { navigate, go } = useGo();
  const openSettings = useOpenPeerSettings();
  const pullRequestsSupported = usePullRequestsSupported();
  const onPullRequests = useLocation({
    select: (location) => location.pathname === "/pull-requests",
  });
  const slot = { environmentId, status, project, activeThread };
  const knowledge = projectSignals(status, project, plugins).find(
    (signal) => signal.id === "knowledge",
  );
  const state = status.workspaces
    .find((workspace) => workspace.slug === project.workspace)
    ?.projects.find((candidate) => candidate.project.id === project.projectId);
  const t3ProjectId = state === undefined ? undefined : projectCheckout(state).projectId;
  const contextOpen = `context:${project.workspace}:${project.projectId}:project`;
  return (
    <SidebarMenu aria-label={`${project.name} navigation`}>
      {knowledge === undefined ? null : (
        <NavRow
          icon={LightbulbIcon}
          label="Knowledge"
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
          label="Shared context"
          active={activeThread === contextOpen}
          trailing={<NavCount>v{project.context?.version}</NavCount>}
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
      {onHistory === undefined ? null : (
        <NavRow
          icon={ActivityIcon}
          label="Activity"
          trailing={plugins.map(({ id, historyBadge: Mark }) =>
            Mark === undefined ? null : <Mark key={id} {...slot} />,
          )}
          onClick={onHistory}
        />
      )}
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
      <NavRow
        icon={SlidersHorizontalIcon}
        label="Project settings"
        onClick={() =>
          go(() =>
            openSettings({
              kind: "project",
              workspace: project.workspace,
              projectId: project.projectId,
              tab: DEFAULT_PROJECT_TAB,
            }),
          )
        }
      />
    </SidebarMenu>
  );
}
