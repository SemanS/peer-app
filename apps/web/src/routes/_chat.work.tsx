import { createFileRoute } from "@tanstack/react-router";

import { RoomFeed } from "../components/workspaces/rooms/RoomFeed";
import { workSearch } from "../components/workspaces/workNavigation.logic";

export const Route = createFileRoute("/_chat/work")({
  validateSearch: workSearch,
  component: RoomFeed,
});
