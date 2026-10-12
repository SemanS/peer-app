import { createFileRoute } from "@tanstack/react-router";

import { TaskView } from "../components/workspaces/task/TaskView";

export const Route = createFileRoute("/_chat/task/$workspace/$project/$task")({
  component: TaskRouteView,
});

function TaskRouteView() {
  const { workspace, project, task } = Route.useParams();
  return <TaskView workspace={workspace} project={project} task={task} />;
}
