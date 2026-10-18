import { createFileRoute } from "@tanstack/react-router";

import { PeerPluginPage } from "../components/workspaces/PluginOff";
import { IntegrationPreview } from "../components/workspaces/forecast/IntegrationPreview";

export const Route = createFileRoute("/_chat/integration/$workspace/$project")({
  component: IntegrationRouteView,
});

/** The preview belongs to the forecast plugin: where it is off, the page says so and how to turn it on. */
function IntegrationRouteView() {
  const { workspace, project } = Route.useParams();
  return (
    <PeerPluginPage plugin="forecast" title="Merge conflict forecast">
      <IntegrationPreview workspace={workspace} project={project} />
    </PeerPluginPage>
  );
}
