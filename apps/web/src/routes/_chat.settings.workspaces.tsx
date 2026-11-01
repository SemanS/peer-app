import { createFileRoute, redirect } from "@tanstack/react-router";

/** The old Workspaces page: everything on it moved into the Peer settings area. */
export const Route = createFileRoute("/_chat/settings/workspaces")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/peer", replace: true });
  },
});
