import type { ComponentType } from "react";

import { usePeerSettings } from "./PeerSettingsContext";
import { PeerSettingsFrame } from "./PeerSettingsPage";
import { PeerSettingsMissing } from "./PeerSettingsMissing";
import { PeerSettingsRedirect } from "./peerSettingsLinks";
import { DEFAULT_PROJECT_TAB, isProjectTab, type ProjectTab } from "./peerSettings.logic";
import type { ProjectPageProps } from "./pageProps";
import { ProjectBasics } from "./pages/ProjectBasics";
import { ProjectCapacity } from "./pages/ProjectCapacity";
import { ProjectCoordination } from "./pages/ProjectCoordination";
import { ProjectHistory } from "./pages/ProjectHistory";
import { ProjectPeople } from "./pages/ProjectPeople";
import { ProjectRepositories } from "./pages/ProjectRepositories";
import { ProjectTasks } from "./pages/ProjectTasks";
import { ProjectTools } from "./pages/ProjectTools";
import { ProjectHeader } from "./ProjectHeader";
import { ProposalsBanner } from "./Proposals";

const PAGES: Readonly<Record<ProjectTab, ComponentType<ProjectPageProps>>> = {
  basics: ProjectBasics,
  people: ProjectPeople,
  tasks: ProjectTasks,
  repositories: ProjectRepositories,
  tools: ProjectTools,
  capacity: ProjectCapacity,
  coordination: ProjectCoordination,
  history: ProjectHistory,
};

/** `/settings/peer/w/<workspace>/project/<id>/<tab>`: the project's header over one of its tabs. */
export function ProjectTabRoute({
  workspace: slug,
  projectId,
  tab,
}: {
  readonly workspace: string;
  readonly projectId: string;
  readonly tab: string;
}) {
  const { environmentId, status } = usePeerSettings();
  if (!isProjectTab(tab)) {
    return (
      <PeerSettingsRedirect
        to={{ kind: "project", workspace: slug, projectId, tab: DEFAULT_PROJECT_TAB }}
      />
    );
  }
  const workspace = status.workspaces.find((candidate) => candidate.slug === slug);
  // Project ids are unique only within a workspace.
  const state = workspace?.projects.find((candidate) => candidate.project.id === projectId);
  if (workspace === undefined || state === undefined) {
    return (
      <PeerSettingsMissing title="Project not found">
        {workspace === undefined
          ? `You are not in a workspace called “${slug}” on this computer.`
          : `${workspace.name} lists no project “${projectId}” for you.`}
      </PeerSettingsMissing>
    );
  }
  const Page = PAGES[tab];
  // Keyed by project: switching projects starts a fresh page, so a clone under way belongs to its
  // project and the scroll starts at the top; switching tabs keeps the header in place.
  return (
    <PeerSettingsFrame key={`${workspace.slug}/${state.project.id}`}>
      <ProjectHeader workspace={workspace} state={state} tab={tab} />
      <ProposalsBanner />
      <Page environmentId={environmentId} status={status} workspace={workspace} state={state} />
    </PeerSettingsFrame>
  );
}
