import { createFileRoute } from "@tanstack/react-router";

import { isProjectSetView, ProjectSetView } from "../components/workspaces/ProjectSetView";

export const Route = createFileRoute("/_chat/workspace/$setId")({
  validateSearch: (search: Record<string, unknown>) =>
    isProjectSetView(search.view) && search.view !== "room" ? { view: search.view } : {},
  component: ProjectSetRouteView,
});

function ProjectSetRouteView() {
  const { setId } = Route.useParams();
  const { view } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProjectSetView
      setId={setId}
      view={view ?? "room"}
      onView={(next) =>
        void navigate({ search: next === "room" ? {} : { view: next }, replace: true })
      }
    />
  );
}
