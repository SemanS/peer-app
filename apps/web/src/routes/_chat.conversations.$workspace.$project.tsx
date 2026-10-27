import type { EnvironmentId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { parseContextCompare } from "../components/workspaces/contextCompare.logic";
import { ConversationsView } from "../components/workspaces/conversations/ConversationsView";

export const Route = createFileRoute("/_chat/conversations/$workspace/$project")({
  validateSearch: (search): { readonly environmentId?: EnvironmentId | undefined } => {
    const { environmentId } = parseContextCompare(search);
    return environmentId === undefined ? {} : { environmentId };
  },
  component: ConversationsRouteView,
});

function ConversationsRouteView() {
  const { workspace, project } = Route.useParams();
  const { environmentId } = Route.useSearch();
  return (
    <ConversationsView workspace={workspace} project={project} environmentId={environmentId} />
  );
}
