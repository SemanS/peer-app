import type { PeerProjectState, PeerWorkspaceState } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "../../ui/button";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { ProjectMark } from "../signals";
import { useSidebarView } from "../SidebarViewSwitch";
import { projectScopeKey } from "../workBoard.logic";
import { useWorkScope } from "../workScope";
import {
  PROJECT_TABS,
  PROJECT_TAB_LABELS,
  isProjectTab,
  projectRoleBadge,
  type ProjectTab,
} from "./peerSettings.logic";
import { useOpenPeerSettings } from "./peerSettingsLinks";
import { RoleBadgePill } from "./PeerSettingsPage";

/**
 * The top of a project's settings: its mark and name, its client, the person's part in it, a way
 * into the Work views scoped to it, and the tabs, one page of the area each.
 */
export function ProjectHeader({
  workspace,
  state,
  tab,
}: {
  readonly workspace: PeerWorkspaceState;
  readonly state: PeerProjectState;
  readonly tab: ProjectTab;
}) {
  const { project } = state;
  const open = useOpenPeerSettings();
  const navigate = useNavigate();
  const [, setWorkScope] = useWorkScope();
  const [, setSidebarView] = useSidebarView();
  const scopeKey = projectScopeKey({ workspace: workspace.slug, projectId: project.id });
  return (
    <header className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2">
        <ProjectMark name={project.name} colorKey={scopeKey} className="size-7" />
        <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">{project.name}</h1>
        {project.client === undefined ? null : (
          <span className="text-sm text-muted-foreground">Client · {project.client}</span>
        )}
        <RoleBadgePill badge={projectRoleBadge(workspace.role, project.role)} />
        <Button
          className="ms-auto"
          size="sm"
          variant="outline"
          onClick={() => {
            // The sidebar's Work view and the Work board share one project scope.
            setWorkScope(scopeKey);
            setSidebarView("work");
            void navigate({ to: "/work" });
          }}
        >
          Open in Work
        </Button>
      </div>
      <div className="overflow-x-auto">
        <ToggleGroup
          aria-label="Project settings"
          value={[tab]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === undefined || !isProjectTab(value)) return;
            void open({
              kind: "project",
              workspace: workspace.slug,
              projectId: project.id,
              tab: value,
            });
          }}
        >
          {PROJECT_TABS.map((item) => (
            <Toggle key={item} value={item}>
              {PROJECT_TAB_LABELS[item]}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
    </header>
  );
}
