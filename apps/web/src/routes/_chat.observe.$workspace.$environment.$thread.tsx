import { createFileRoute } from "@tanstack/react-router";

import { ObserveView } from "../components/workspaces/ObserveView";
import { PeerPluginPage } from "../components/workspaces/PluginOff";

export const Route = createFileRoute("/_chat/observe/$workspace/$environment/$thread")({
  component: ObserveRouteView,
});

function ObserveRouteView() {
  const { workspace, environment, thread } = Route.useParams();
  return (
    <PeerPluginPage plugin="observe" title="Observe">
      <ObserveView workspace={workspace} environment={environment} thread={thread} />
    </PeerPluginPage>
  );
}
