import { createFileRoute } from "@tanstack/react-router";

import { WorkBoard } from "../components/workspaces/WorkBoard";

export const Route = createFileRoute("/_chat/work")({
  component: WorkBoard,
});
