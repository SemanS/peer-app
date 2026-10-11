import type { ProjectPageProps } from "../pageProps";
import { HistoryList } from "../HistoryList";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsView } from "../useSettingsView";

/** A project's History tab: each change to its settings, who made it and why, with a way to revert it. */
export function ProjectHistory({ workspace, state }: ProjectPageProps) {
  const view = useSettingsView(workspace.slug);
  return (
    <>
      <h2 className="sr-only">History</h2>
      {view.hubHasSettings ? (
        <HistoryList
          workspace={workspace}
          scope={`project:${state.project.id}`}
          scopeName={state.project.name}
        />
      ) : (
        <SettingsUnavailableNote />
      )}
    </>
  );
}
