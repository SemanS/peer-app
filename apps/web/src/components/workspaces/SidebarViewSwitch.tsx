import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { usePrimaryEnvironment } from "../../state/environments";
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
    <div className="flex flex-col gap-1.5">
      <ToggleGroup
        className="w-full"
        aria-label="Sidebar view"
        variant="segmented"
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
      <p className="truncate px-1 text-xs text-muted-foreground">{scopeLine}</p>
    </div>
  );
}
