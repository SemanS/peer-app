import { createFileRoute } from "@tanstack/react-router";

import { ProjectSetView } from "../components/workspaces/ProjectSetView";

export const Route = createFileRoute("/_chat/workspace/$setId")({
  component: ProjectSetRouteView,
});

function ProjectSetRouteView() {
  const { setId } = Route.useParams();
  return <ProjectSetView setId={setId} />;
}
