import { createFileRoute } from "@tanstack/react-router";

import { WorkspaceUsageRoute } from "../components/workspaces/usage/WorkspaceUsageRoute";

export const Route = createFileRoute("/_chat/team-usage/$workspace")({
  component: TeamUsageRouteView,
});

function TeamUsageRouteView() {
  const { workspace } = Route.useParams();
  return <WorkspaceUsageRoute workspace={workspace} />;
}
