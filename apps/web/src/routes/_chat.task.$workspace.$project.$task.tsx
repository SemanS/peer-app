import { createFileRoute, redirect } from "@tanstack/react-router";

/** A task is its room: an address from before rooms replaced the task page lands there. */
export const Route = createFileRoute("/_chat/task/$workspace/$project/$task")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/room/$workspace/$project/$task", params, replace: true });
  },
});
