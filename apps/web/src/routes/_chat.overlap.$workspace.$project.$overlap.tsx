import { EnvironmentId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { OverlapView } from "../components/workspaces/overlap/OverlapView";

export const Route = createFileRoute("/_chat/overlap/$workspace/$project/$overlap")({
  validateSearch: (search: Record<string, unknown>): { environmentId?: EnvironmentId } =>
    typeof search.environmentId === "string" && search.environmentId.trim() !== ""
      ? { environmentId: EnvironmentId.make(search.environmentId) }
      : {},
  component: OverlapRouteView,
});

function OverlapRouteView() {
  const { workspace, project, overlap } = Route.useParams();
  const { environmentId } = Route.useSearch();
  return (
    <OverlapView
      workspace={workspace}
      project={project}
      overlap={overlap}
      environmentId={environmentId}
    />
  );
}
