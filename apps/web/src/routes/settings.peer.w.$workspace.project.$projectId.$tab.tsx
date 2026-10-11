import { createFileRoute } from "@tanstack/react-router";

import { peerSettingsRedirect } from "../components/workspaces/settings/peerSettingsLinks";
import {
  DEFAULT_PROJECT_TAB,
  isProjectTab,
} from "../components/workspaces/settings/peerSettings.logic";
import { ProjectTabRoute } from "../components/workspaces/settings/ProjectTabRoute";

export const Route = createFileRoute("/settings/peer/w/$workspace/project/$projectId/$tab")({
  beforeLoad: ({ params }) => {
    if (!isProjectTab(params.tab)) {
      throw peerSettingsRedirect({
        kind: "project",
        workspace: params.workspace,
        projectId: params.projectId,
        tab: DEFAULT_PROJECT_TAB,
      });
    }
  },
  component: ProjectTabPage,
});

function ProjectTabPage() {
  const { workspace, projectId, tab } = Route.useParams();
  return <ProjectTabRoute workspace={workspace} projectId={projectId} tab={tab} />;
}
