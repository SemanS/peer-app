import { createFileRoute, redirect } from "@tanstack/react-router";

/** An overlap's agents talk in their rooms: its address names no task, so it lands on the Feed. */
export const Route = createFileRoute("/_chat/overlap/$workspace/$project/$overlap")({
  beforeLoad: () => {
    throw redirect({ to: "/work", replace: true });
  },
});
