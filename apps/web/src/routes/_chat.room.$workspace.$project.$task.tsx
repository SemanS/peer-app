import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { PeerPluginPage } from "../components/workspaces/PluginOff";
import { LocalRoomView } from "../components/workspaces/rooms/LocalRoomView";
import { RoomView } from "../components/workspaces/rooms/RoomView";

export const Route = createFileRoute("/_chat/room/$workspace/$project/$task")({
  component: RoomRouteView,
});

function RoomRouteView() {
  const { workspace, project, task } = Route.useParams();
  if (workspace === PEER_LOCAL_WORKSPACE) return <LocalRoomView project={project} />;
  return (
    <PeerPluginPage plugin="rooms" title="Task rooms">
      <RoomView workspace={workspace} project={project} task={task} />
    </PeerPluginPage>
  );
}
