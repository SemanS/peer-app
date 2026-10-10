import { createFileRoute } from "@tanstack/react-router";

import { ReviewView } from "../components/workspaces/review/ReviewView";

export const Route = createFileRoute("/_chat/review/$workspace/$project/$task")({
  component: ReviewRouteView,
});

function ReviewRouteView() {
  const { workspace, project, task } = Route.useParams();
  return <ReviewView workspace={workspace} project={project} task={task} />;
}
