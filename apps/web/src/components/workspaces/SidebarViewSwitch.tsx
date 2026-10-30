import { useLocation } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { MessagesSquareIcon } from "lucide-react";
import { useEffect } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { usePrimaryEnvironment } from "../../state/environments";
import { useUiStateStore } from "../../uiStateStore";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  SIDEBAR_TABS,
  sidebarSwitchChoice,
  sidebarSwitchValue,
  type SidebarTab,
  type SidebarView,
} from "./SidebarViewSwitch.logic";
import { usePeerHubStatus } from "./WorkspaceAccess";
import { sidebarViewForLocation } from "./sidebarRoutes.logic";

export type { SidebarTab, SidebarView } from "./SidebarViewSwitch.logic";

const StoredView = Schema.NullOr(Schema.Literals(["work", "threads"]));
const StoredTab = Schema.Literals(["tasks", "knowledge", "activity"]);

/** Which tab of the team's work the sidebar shows, remembered on this computer. */
export function useSidebarTab(): readonly [SidebarTab, (tab: SidebarTab) => void] {
  return useLocalStorage("peer:sidebar-tab", "tasks", StoredTab);
}

/** The chosen view; until someone chooses, Tasks for people in a workspace, Chats otherwise. */
export function useSidebarView(): readonly [SidebarView, (view: SidebarView) => void] {
  const primary = usePrimaryEnvironment();
  const status = usePeerHubStatus(
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null,
  );
  const [stored, setStored] = useLocalStorage("peer:sidebar-view", null, StoredView);
  const pathname = useLocation({ select: (location) => location.pathname });
  const routes = useUiStateStore((state) => state.sidebarRoutes);
  const fallback: SidebarView =
    status !== null && status.signedIn && status.workspaces.length > 0 ? "work" : "threads";
  return [sidebarViewForLocation(pathname, routes, stored ?? fallback), setStored];
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
 * Tasks, Knowledge and Activity (the team's work, each with a purpose of its own) and, by its icon,
 * Chats (this computer's threads).
 */
export function SidebarViewSwitch({
  view,
  tab,
  onChange,
  onTab,
  scopeLine,
}: {
  readonly view: SidebarView;
  readonly tab: SidebarTab;
  readonly onChange: (view: SidebarView) => void;
  readonly onTab: (tab: SidebarTab) => void;
  /** `sidebarScopeLine`: "Work in ‹project›", "Your chats in all projects". */
  readonly scopeLine: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        className="w-full"
        aria-label="Sidebar view"
        variant="liquid"
        size="compact"
        value={[sidebarSwitchValue(view, tab)]}
        onValueChange={(next) => {
          const choice = sidebarSwitchChoice(next[0]);
          if (choice === undefined) return;
          if (choice.tab !== undefined) onTab(choice.tab);
          onChange(choice.view);
        }}
      >
        {SIDEBAR_TABS.map((candidate) => (
          <Toggle key={candidate.id} className="min-w-0 flex-auto" value={candidate.id}>
            <span className="truncate">{candidate.label}</span>
          </Toggle>
        ))}
        <Toggle className="shrink-0" value="chats" aria-label="Chats">
          <MessagesSquareIcon aria-hidden />
        </Toggle>
      </ToggleGroup>
      <p className="sr-only">{scopeLine}</p>
    </div>
  );
}
