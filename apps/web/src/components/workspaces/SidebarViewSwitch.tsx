import { useLocation } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useEffect } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { usePrimaryEnvironment } from "../../state/environments";
import { useUiStateStore } from "../../uiStateStore";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SIDEBAR_VIEW_LABELS, type SidebarView } from "./SidebarViewSwitch.logic";
import { usePeerHubStatus } from "./WorkspaceAccess";

export type { SidebarView } from "./SidebarViewSwitch.logic";

const StoredView = Schema.NullOr(Schema.Literals(["work", "threads"]));

/** The chosen view; until someone chooses, Tasks for people in a workspace, Chats otherwise. */
export function useSidebarView(): readonly [SidebarView, (view: SidebarView) => void] {
  const primary = usePrimaryEnvironment();
  const status = usePeerHubStatus(
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null,
  );
  const [stored, setStored] = useLocalStorage("peer:sidebar-view", null, StoredView);
  const fallback: SidebarView =
    status !== null && status.signedIn && status.workspaces.length > 0 ? "work" : "threads";
  return [stored ?? fallback, setStored];
}

/**
 * Records the screen the main area shows under the view it belongs to (`sidebarRoutes`), so
 * switching back to that view returns to it.
 */
export function useRememberSidebarRoute(): void {
  const href = useLocation({ select: (location) => location.href });
  const remember = useUiStateStore((state) => state.rememberSidebarRoute);
  useEffect(() => {
    remember(href);
  }, [href, remember]);
}

/**
 * Tasks (the team's work, Project → Area → Task) or Chats (this computer's threads), and under
 * it one line saying which project they show.
 */
export function SidebarViewSwitch({
  view,
  onChange,
  scopeLine,
}: {
  readonly view: SidebarView;
  readonly onChange: (view: SidebarView) => void;
  /** `sidebarScopeLine`: "Team tasks in ‹project›", "Your chats in all projects". */
  readonly scopeLine: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        className="w-full"
        aria-label="Sidebar view"
        variant="navigation"
        value={[view]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === "work" || value === "threads") onChange(value);
        }}
      >
        <Toggle className="flex-1" value="work">
          {SIDEBAR_VIEW_LABELS.work}
        </Toggle>
        <Toggle className="flex-1" value="threads">
          {SIDEBAR_VIEW_LABELS.threads}
        </Toggle>
      </ToggleGroup>
      <p className="sr-only">{scopeLine}</p>
    </div>
  );
}
