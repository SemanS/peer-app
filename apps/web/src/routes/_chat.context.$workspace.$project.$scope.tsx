import { createFileRoute, redirect } from "@tanstack/react-router";

const TASK_SCOPE = "task:";

/** A task's context page is its room now; a project's has no page of its own. */
export const Route = createFileRoute("/_chat/context/$workspace/$project/$scope")({
  beforeLoad: ({ params: { workspace, project, scope } }) => {
    if (!scope.startsWith(TASK_SCOPE)) throw redirect({ to: "/work", replace: true });
    throw redirect({
      to: "/room/$workspace/$project/$task",
      params: { workspace, project, task: scope.slice(TASK_SCOPE.length) },
      replace: true,
    });
  },
});
