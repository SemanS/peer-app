import { createFileRoute } from "@tanstack/react-router";

import { KnowledgeView } from "../components/workspaces/knowledge/KnowledgeView";
import { PeerPluginPage } from "../components/workspaces/PluginOff";

export const Route = createFileRoute("/_chat/knowledge/$workspace/$project")({
  component: KnowledgeRouteView,
});

function KnowledgeRouteView() {
  const { workspace, project } = Route.useParams();
  return (
    <PeerPluginPage plugin="knowledge" title="Knowledge" handlesDisconnected>
      <KnowledgeView workspace={workspace} project={project} />
    </PeerPluginPage>
  );
}
