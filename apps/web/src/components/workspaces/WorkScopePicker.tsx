import { useState } from "react";
import { taskShortTitle } from "@t3tools/client-runtime/peer/taskTitle";
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDownIcon, PlusIcon, Share2Icon, ShieldIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useFileContextMenu } from "../../fileContextMenu";
import { cn } from "../../lib/utils";
import { projectIconColorClassName } from "../../projectIconColors";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { Badge } from "../ui/badge";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { useSidebar } from "../ui/sidebar";
import {
  localProjectGroups,
  peerProjectIndex,
  type ResolvedProjectScope,
} from "./projectScope.logic";
import { useOrganizationStatus } from "./ActiveOrganization";
import { usePeerHub, useProjectScope } from "./projectScope";
import { useOpenPeerSettings } from "./settings/peerSettingsLinks";
import { projectSignals } from "./ProjectSignals";
import { sidebarTasks } from "./sidebarTasks.logic";
import { ProjectMark, projectColor } from "./signals";
import {
  actionsForScope,
  openFolderLabel,
  projectButtonLines,
  projectMenuSections,
} from "./WorkScopePicker.logic";
import { ALL_PROJECTS, projectScopeKey } from "./workBoard.logic";
import { useWorkData } from "./useWorkData";
import type { WorkProjectNode } from "./workTree.logic";

/** Every project at once: a square of the first projects' colors. */
export function AllProjectsMark({
  tree,
  className,
}: {
  readonly tree: ReadonlyArray<Pick<WorkProjectNode, "workspace" | "projectId">>;
  readonly className?: string;
}) {
  const colors = tree.slice(0, 4).map((project) => projectColor(projectScopeKey(project)));
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 shrink-0 grid-cols-2 gap-px rounded-[25%] bg-muted p-0.5",
        className,
      )}
    >
      {[0, 1, 2, 3].map((index) => {
        const color = colors[index];
        return (
          <span
            key={index}
            className={cn(
              "rounded-xs",
              color === undefined ? "bg-muted-foreground/30" : projectIconColorClassName(color),
            )}
            style={color === undefined ? undefined : { backgroundColor: "currentColor" }}
          />
        );
      })}
    </span>
  );
}

/**
 * The project button at the top of the sidebar, and the menu it opens. One choice scopes both
 * views: Tasks lists the team's tasks in that project, Chats this person's chats in it. The menu
 * lists each workspace's projects, then the projects of this computer that no workspace shares,
 * then all of them.
 */
export function WorkScopePicker({
  groups,
  compact = false,
}: {
  /** The sidebar's project catalog, which says what a local project is. */
  readonly groups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly compact?: boolean;
}) {
  const { status } = usePeerHub();
  const [open, setOpen] = useState(false);
  const current = useProjectScope(groups);
  // Every workspace's projects tell a shared checkout from a local one; the menu lists the
  // active organization's.
  const peer = peerProjectIndex(status);
  const workspaces = useOrganizationStatus(status)?.workspaces ?? [];
  const lines = projectButtonLines(current, workspaces);
  const marks = workspaces.flatMap((workspace) =>
    workspace.projects.map((state) => ({ workspace: workspace.slug, projectId: state.project.id })),
  );
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={`Project: ${lines.name}, in ${lines.where}`}
            className={cn(
              "flex min-w-0 items-center text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-sidebar-row-active",
              compact
                ? "max-w-56 gap-2 rounded-md px-2 py-1.5"
                : "w-full gap-3 rounded-xl px-2.5 py-3",
            )}
          />
        }
      >
        <ScopeMark current={current} marks={marks} className={compact ? "size-4" : "size-7"} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold text-sidebar-foreground">
            {lines.name}
          </span>
          {compact ? null : <ScopeSubtitle scope={current.scope} fallback={lines.where} />}
        </span>
        <ChevronsUpDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-(--anchor-width) min-w-72">
        <ProjectMenuBody
          groups={groups}
          peer={peer}
          marks={marks}
          current={current}
          onChange={(scope) => {
            setOpen(false);
            current.setScope(scope);
          }}
        />
      </MenuPopup>
    </Menu>
  );
}

/** Under the project's name: the change its open work belongs to, else where the project lives. */
function ScopeSubtitle({ scope, fallback }: { readonly scope: string; readonly fallback: string }) {
  const { tree } = useWorkData();
  const project = tree.find((candidate) => projectScopeKey(candidate) === scope);
  const change = project === undefined ? undefined : sidebarTasks(project).change;
  return (
    <span className="truncate text-xs text-muted-foreground">
      {change === undefined ? fallback : taskShortTitle(change)}
    </span>
  );
}

/** The mark of the project in scope, or of all projects. */
function ScopeMark({
  current,
  marks,
  className,
}: {
  readonly current: ResolvedProjectScope;
  readonly marks: ReadonlyArray<Pick<WorkProjectNode, "workspace" | "projectId">>;
  readonly className: string;
}) {
  return current.name === undefined ? (
    <AllProjectsMark tree={marks} className={className} />
  ) : (
    <ProjectMark name={current.name} colorKey={current.scope} className={className} />
  );
}

/**
 * What the menu holds. It mounts when the menu opens, so the work tree and what waits on the
 * person, which the counts need, are only read while someone looks.
 */
function ProjectMenuBody({
  groups,
  peer,
  marks,
  current,
  onChange,
}: {
  readonly groups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly peer: ReturnType<typeof peerProjectIndex>;
  readonly marks: ReadonlyArray<Pick<WorkProjectNode, "workspace" | "projectId">>;
  readonly current: ResolvedProjectScope;
  readonly onChange: (scope: string) => void;
}) {
  const { environmentId, status, tree, needs, actions, plugins } = useWorkData();
  const navigate = useNavigate();
  const openSettings = useOpenPeerSettings();
  const files = useFileContextMenu(environmentId);
  const { isMobile, setOpenMobile } = useSidebar();
  const sections = projectMenuSections({
    workspaces: status?.workspaces ?? [],
    tree,
    needs,
    locals: localProjectGroups(groups, peer),
  });
  // What the menu does on the project in scope: its coordination, settings, folder and removal.
  const menu = actionsForScope(current.scope, { status, groups });
  const leave = () => {
    if (isMobile) setOpenMobile(false);
  };
  const folder = menu?.folder;
  const coordination = menu?.kind === "workspace" ? menu.coordination : null;
  const scoped = tree.find((project) => projectScopeKey(project) === current.scope);
  const team =
    status === null || scoped === undefined
      ? undefined
      : projectSignals(status, scoped, plugins).find((signal) => signal.id === "team");
  return (
    <>
      <MenuRadioGroup value={current.scope} onValueChange={(value) => onChange(String(value))}>
        {sections.map((section) => (
          <MenuGroup key={section.id}>
            <MenuGroupLabel>{section.heading}</MenuGroupLabel>
            {section.rows.map((row) => (
              <MenuRadioItem key={row.scope} value={row.scope} label={row.name}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <ProjectMark name={row.name} colorKey={row.scope} className="size-5" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{row.name}</span>
                    {row.folder === undefined ? null : (
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {row.folder}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end text-xs">
                    {row.active === undefined ? null : (
                      <span className="text-muted-foreground">{row.active}</span>
                    )}
                    {row.needs === undefined ? null : (
                      <span className="text-warning-foreground">{row.needs}</span>
                    )}
                  </span>
                  <MenuRadioItemIndicator />
                </span>
              </MenuRadioItem>
            ))}
          </MenuGroup>
        ))}
        <MenuRadioItem value={ALL_PROJECTS} label="All projects">
          <span className="flex min-w-0 items-center gap-2.5">
            <AllProjectsMark tree={marks} className="size-5" />
            <span className="min-w-0 flex-1 truncate font-medium">All projects</span>
            <span className="shrink-0 text-xs text-muted-foreground">grouped by project</span>
            <MenuRadioItemIndicator />
          </span>
        </MenuRadioItem>
      </MenuRadioGroup>
      <MenuItem onClick={() => openCommandPalette({ open: "add-project" })}>
        <PlusIcon aria-hidden />
        Add a project…
      </MenuItem>
      {menu === null ? null : (
        <>
          <MenuSeparator />
          <MenuGroup>
            <MenuGroupLabel>{menu.name}</MenuGroupLabel>
            {coordination === null ? null : (
              <MenuItem
                onClick={() => {
                  leave();
                  void openSettings(coordination.action.location);
                }}
              >
                <ShieldIcon aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{coordination.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {coordination.detail}
                  </span>
                </span>
                <Badge variant="outline" size="control">
                  {coordination.action.label}
                </Badge>
              </MenuItem>
            )}
            {team === undefined ? null : (
              <MenuItem
                inset
                onClick={() => {
                  leave();
                  void team.open?.(navigate);
                }}
              >
                People and owners
              </MenuItem>
            )}
            <MenuItem
              inset
              onClick={() => {
                leave();
                if (menu.kind === "workspace") void openSettings(menu.settings);
                else
                  void navigate({
                    to: "/projects/$projectKey",
                    params: { projectKey: menu.projectKey },
                  });
              }}
            >
              Project settings
            </MenuItem>
            <MenuItem
              inset
              disabled={folder === undefined || !files.capabilities.canOpenDefault}
              onClick={() => {
                if (folder === undefined) return;
                void files.activate("open", {
                  environmentId,
                  filePath: folder,
                  workspaceRoot: undefined,
                });
              }}
            >
              {openFolderLabel(files.capabilities.revealLabel, navigator.platform)}
            </MenuItem>
            {menu.kind === "local" && status?.signedIn
              ? status.workspaces.map((workspace) => (
                  <MenuItem
                    key={workspace.slug}
                    onClick={() => {
                      leave();
                      void actions.shareProject(menu.project, menu.name, workspace);
                    }}
                  >
                    <Share2Icon aria-hidden />
                    Share with {workspace.name}…
                  </MenuItem>
                ))
              : null}
            {menu.kind === "workspace" && menu.remove ? (
              <MenuItem
                inset
                variant="destructive"
                onClick={() =>
                  void actions.removeProject(
                    { workspace: menu.workspace, projectId: menu.projectId },
                    menu.name,
                    menu.workspaceName,
                  )
                }
              >
                Remove from workspace…
              </MenuItem>
            ) : null}
          </MenuGroup>
        </>
      )}
    </>
  );
}
