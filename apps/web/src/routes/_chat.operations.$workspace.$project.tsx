import { createFileRoute } from "@tanstack/react-router";

import { OperationsView } from "../components/workspaces/jujutsu/OperationsView";
import { PeerPluginPage } from "../components/workspaces/PluginOff";

export const Route = createFileRoute("/_chat/operations/$workspace/$project")({
  component: OperationsRouteView,
});

function OperationsRouteView() {
  const { workspace, project } = Route.useParams();
  return (
    <PeerPluginPage plugin="jujutsu" title="Operations">
      <OperationsView workspace={workspace} project={project} />
    </PeerPluginPage>
  );
}
