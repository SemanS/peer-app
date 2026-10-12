import { createFileRoute } from "@tanstack/react-router";

import { teamSearchOf, type TeamSearch } from "../components/workspaces/ownership/teamNavigation";
import { TeamRoute } from "../components/workspaces/ownership/TeamRoute";

export const Route = createFileRoute("/_chat/team/$workspace/$project")({
  validateSearch: (search: Record<string, unknown>): TeamSearch => teamSearchOf(search),
  component: TeamRouteView,
});

function TeamRouteView() {
  const { workspace, project } = Route.useParams();
  return <TeamRoute workspace={workspace} project={project} search={Route.useSearch()} />;
}
