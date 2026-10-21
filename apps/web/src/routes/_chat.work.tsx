import { createFileRoute } from "@tanstack/react-router";

import { WorkBoard } from "../components/workspaces/WorkBoard";
import { workSearch } from "../components/workspaces/workNavigation.logic";

export const Route = createFileRoute("/_chat/work")({
  validateSearch: workSearch,
  component: WorkBoard,
});
