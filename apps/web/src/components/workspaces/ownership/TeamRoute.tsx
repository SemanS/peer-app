import { PeerPluginPage } from "../PluginOff";
import type { TeamSearch } from "./teamNavigation";
import { TeamPage } from "./TeamPage";

/**
 * The route's page: the Team page while the ownership plugin is active on the environment, and the
 * plugin's own off page (why it is off, and for its owner how to turn it on) where a link to the
 * page finds it is not, so no link lands on a feature the environment does not run.
 */
export function TeamRoute({
  workspace,
  project,
  search,
}: {
  readonly workspace: string;
  readonly project: string;
  readonly search: TeamSearch;
}) {
  return (
    <PeerPluginPage plugin="ownership" title="Ownership">
      <TeamPage workspace={workspace} project={project} view={search.view ?? "team"} />
    </PeerPluginPage>
  );
}
