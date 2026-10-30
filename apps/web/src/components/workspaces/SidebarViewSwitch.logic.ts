import { ALL_PROJECTS } from "./workBoard.logic";

/**
 * What the sidebar lists: the team's tasks or this computer's chats. The stored values predate
 * the names people read (`peer:sidebar-view` holds "work" and "threads"), and stay.
 */
export type SidebarView = "work" | "threads";

/** The words on the switch. */
export const SIDEBAR_VIEW_LABELS: Readonly<Record<SidebarView, string>> = {
  work: "Work",
  threads: "Chats",
};

/** What the sidebar shows of the team's work: each answers its own question, none repeats another. */
export type SidebarTab = "tasks" | "knowledge" | "activity";

export const SIDEBAR_TABS: ReadonlyArray<{ readonly id: SidebarTab; readonly label: string }> = [
  { id: "tasks", label: "Tasks" },
  { id: "knowledge", label: "Knowledge" },
  { id: "activity", label: "Activity" },
];

/** The switch's one value: a tab of the team's work, or the chats. */
export function sidebarSwitchValue(view: SidebarView, tab: SidebarTab): SidebarTab | "chats" {
  return view === "threads" ? "chats" : tab;
}

/** What a choice on the switch means; undefined for one that is not on it. */
export function sidebarSwitchChoice(
  value: unknown,
): { readonly view: SidebarView; readonly tab?: SidebarTab } | undefined {
  if (value === "chats") return { view: "threads" };
  const tab = SIDEBAR_TABS.find((candidate) => candidate.id === value);
  return tab === undefined ? undefined : { view: "work", tab: tab.id };
}

/**
 * The line under the switch: what the view shows, and where. One project choice drives both views,
 * so the line is the same sentence with the view's own subject: "Team tasks in Receipt printer",
 * "Your chats in all projects". A scope whose project has no name (the Hub has not said yet) is
 * every project, the way the lists treat it.
 */
export function sidebarScopeLine(
  view: SidebarView,
  scope: string,
  projectName: string | undefined,
): string {
  const where = scope === ALL_PROJECTS || projectName === undefined ? "all projects" : projectName;
  return `${view === "work" ? "Work" : "Your chats"} in ${where}`;
}
