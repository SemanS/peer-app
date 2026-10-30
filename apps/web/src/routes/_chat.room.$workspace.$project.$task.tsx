import { createFileRoute } from "@tanstack/react-router";

import { PeerPluginPage } from "../components/workspaces/PluginOff";
import { RoomView } from "../components/workspaces/rooms/RoomView";

export const Route = createFileRoute("/_chat/room/$workspace/$project/$task")({
  component: RoomRouteView,
});

function RoomRouteView() {
  const { workspace, project, task } = Route.useParams();
  return (
    <PeerPluginPage plugin="rooms" title="Task rooms">
      <RoomView workspace={workspace} project={project} task={task} />
    </PeerPluginPage>
  );
}
