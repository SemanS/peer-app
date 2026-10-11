import { createFileRoute } from "@tanstack/react-router";

import { peerSettingsRedirect } from "../components/workspaces/settings/peerSettingsLinks";
import {
  DEFAULT_WORKSPACE_SECTION,
  isWorkspaceSection,
} from "../components/workspaces/settings/peerSettings.logic";
import { WorkspaceSectionRoute } from "../components/workspaces/settings/WorkspaceSectionRoute";

export const Route = createFileRoute("/settings/peer/w/$workspace/$section")({
  beforeLoad: ({ params }) => {
    if (!isWorkspaceSection(params.section)) {
      throw peerSettingsRedirect({
        kind: "workspace",
        workspace: params.workspace,
        section: DEFAULT_WORKSPACE_SECTION,
      });
    }
  },
  component: WorkspaceSectionPage,
});

function WorkspaceSectionPage() {
  const { workspace, section } = Route.useParams();
  return <WorkspaceSectionRoute workspace={workspace} section={section} />;
}
