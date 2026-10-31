import { createFileRoute } from "@tanstack/react-router";

import { PeerPluginPage } from "../components/workspaces/PluginOff";
import { SharedRoomView } from "../components/workspaces/rooms/SharedRoomView";

export const Route = createFileRoute("/_chat/together/$group")({
  component: SharedRoomRouteView,
});

function SharedRoomRouteView() {
  const { group } = Route.useParams();
  return (
    <PeerPluginPage plugin="rooms" title="Task rooms">
      <SharedRoomView group={group} />
    </PeerPluginPage>
  );
}
