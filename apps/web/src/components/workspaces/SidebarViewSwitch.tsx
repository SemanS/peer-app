import { useLocation } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { MessagesSquareIcon } from "lucide-react";
import { useEffect } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { usePrimaryEnvironment } from "../../state/environments";
import { useUiStateStore } from "../../uiStateStore";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SIDEBAR_VIEW_LABELS, type SidebarView } from "./SidebarViewSwitch.logic";
import { usePeerHubStatus } from "./WorkspaceAccess";
import { sidebarViewForLocation } from "./sidebarRoutes.logic";

export type { SidebarView } from "./SidebarViewSwitch.logic";

const StoredView = Schema.NullOr(Schema.Literals(["work", "threads"]));

/** The chosen view; until someone chooses, Work for people in a workspace, Chats otherwise. */
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

/** Work (the team's tasks and rooms) and, by its icon, Chats (this computer's threads). */
export function SidebarViewSwitch({
  view,
  onChange,
  scopeLine,
}: {
  readonly view: SidebarView;
  readonly onChange: (view: SidebarView) => void;
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
        value={[view]}
        onValueChange={(next) => {
          const choice = next[0];
          if (choice === "work" || choice === "threads") onChange(choice);
        }}
      >
        <Toggle className="min-w-0 flex-auto" value="work">
          <span className="truncate">{SIDEBAR_VIEW_LABELS.work}</span>
        </Toggle>
        <Toggle className="shrink-0" value="threads" aria-label={SIDEBAR_VIEW_LABELS.threads}>
          <MessagesSquareIcon aria-hidden />
        </Toggle>
      </ToggleGroup>
      <p className="sr-only">{scopeLine}</p>
    </div>
  );
}
