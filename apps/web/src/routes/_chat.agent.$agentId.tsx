import { createFileRoute } from "@tanstack/react-router";

import { AgentView } from "../components/workspaces/AgentView";
import { PeerPluginPage } from "../components/workspaces/PluginOff";

export const Route = createFileRoute("/_chat/agent/$agentId")({
  component: AgentRouteView,
});

function AgentRouteView() {
  const { agentId } = Route.useParams();
  return (
    <PeerPluginPage plugin="herdr" title="herdr agents">
      <AgentView agentId={agentId} />
    </PeerPluginPage>
  );
}
