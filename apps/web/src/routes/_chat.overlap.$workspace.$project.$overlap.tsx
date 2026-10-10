import { createFileRoute } from "@tanstack/react-router";

import { OverlapView } from "../components/workspaces/overlap/OverlapView";

export const Route = createFileRoute("/_chat/overlap/$workspace/$project/$overlap")({
  component: OverlapRouteView,
});

function OverlapRouteView() {
  const { workspace, project, overlap } = Route.useParams();
  return <OverlapView workspace={workspace} project={project} overlap={overlap} />;
}
