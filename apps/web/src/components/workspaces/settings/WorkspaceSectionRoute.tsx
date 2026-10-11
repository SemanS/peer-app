import type { ComponentType } from "react";

import { usePeerSettings } from "./PeerSettingsContext";
import { PeerSettingsMissing } from "./PeerSettingsMissing";
import { PeerSettingsRedirect } from "./peerSettingsLinks";
import {
  DEFAULT_WORKSPACE_SECTION,
  isWorkspaceSection,
  type WorkspaceSection,
} from "./peerSettings.logic";
import type { WorkspacePageProps } from "./pageProps";
import { AiSubscriptions } from "./pages/AiSubscriptions";
import { AuditLogPage } from "./pages/AuditLogPage";
import { HubStatus } from "./pages/HubStatus";
import { Integrations } from "./pages/Integrations";
import { KeysPage } from "./pages/KeysPage";
import { NewProject } from "./pages/NewProject";
import { Secrets } from "./pages/Secrets";
import { SharedCapacity } from "./pages/SharedCapacity";
import { SlackPage } from "./pages/SlackPage";
import { ToolCatalog } from "./pages/ToolCatalog";
import { WorkspaceGeneral } from "./pages/WorkspaceGeneral";
import { WorkspacePeople } from "./pages/WorkspacePeople";

const PAGES: Readonly<Record<WorkspaceSection, ComponentType<WorkspacePageProps>>> = {
  general: WorkspaceGeneral,
  people: WorkspacePeople,
  capacity: SharedCapacity,
  tools: ToolCatalog,
  secrets: Secrets,
  integrations: Integrations,
  audit: AuditLogPage,
  hub: HubStatus,
  "new-project": NewProject,
  plans: AiSubscriptions,
  keys: KeysPage,
  slack: SlackPage,
};

/** `/settings/peer/w/<workspace>/<section>`: one workspace's page, or the Me page of that workspace. */
export function WorkspaceSectionRoute({
  workspace: slug,
  section,
}: {
  readonly workspace: string;
  readonly section: string;
}) {
  const { environmentId, status } = usePeerSettings();
  if (!isWorkspaceSection(section)) {
    return (
      <PeerSettingsRedirect
        to={{ kind: "workspace", workspace: slug, section: DEFAULT_WORKSPACE_SECTION }}
      />
    );
  }
  const workspace = status.workspaces.find((candidate) => candidate.slug === slug);
  if (workspace === undefined) {
    return (
      <PeerSettingsMissing title="Workspace not found">
        You are not in a workspace called “{slug}” on this computer.
      </PeerSettingsMissing>
    );
  }
  const Page = PAGES[section];
  // Keyed, so what a page holds (a member list read, a form half filled) stays with its workspace.
  return (
    <Page
      key={workspace.slug}
      environmentId={environmentId}
      status={status}
      workspace={workspace}
    />
  );
}
