import { createFileRoute } from "@tanstack/react-router";

import { ChangesView } from "../components/workspaces/changes/ChangesView";
import { PeerPluginPage } from "../components/workspaces/PluginOff";

export const Route = createFileRoute("/_chat/changes/$workspace/$project")({
  component: ChangesRouteView,
});

// An environment whose Hub predates changes lands on the page every inactive plugin shows.
function ChangesRouteView() {
  const { workspace, project } = Route.useParams();
  return (
    <PeerPluginPage plugin="changes" title="Changes" handlesDisconnected>
      <ChangesView workspace={workspace} project={project} />
    </PeerPluginPage>
  );
}
