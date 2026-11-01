import { createFileRoute, redirect } from "@tanstack/react-router";

/** Finished work is read in its room: an address of the old review page lands there. */
export const Route = createFileRoute("/_chat/review/$workspace/$project/$task")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/room/$workspace/$project/$task", params, replace: true });
  },
});
