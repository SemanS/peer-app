import { createFileRoute } from "@tanstack/react-router";

import { parseContextCompare } from "../components/workspaces/contextCompare.logic";
import { WorkContextView } from "../components/workspaces/WorkContextView";

export const Route = createFileRoute("/_chat/context/$workspace/$project/$scope")({
  validateSearch: parseContextCompare,
  component: WorkContextRouteView,
});

function WorkContextRouteView() {
  const { workspace, project, scope } = Route.useParams();
  const { compare } = Route.useSearch();
  return (
    <WorkContextView workspace={workspace} project={project} scope={scope} compare={compare} />
  );
}
