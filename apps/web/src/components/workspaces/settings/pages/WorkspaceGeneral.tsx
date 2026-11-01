import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { SettingsSearchTarget } from "../../../settings/settingsLayout";
import { EMAIL_DOMAINS_TARGET } from "../../workspaceAccess.logic";
import { ProjectMark } from "../../signals";
import { failureMessage } from "../../WorkspaceAccess";
import { PageSection, SettingsReadError } from "../PageParts";
import type { WorkspacePageProps } from "../pageProps";
import { ownLimit } from "../../workspaceMembers.logic";
import { isWorkspaceAdmin, workspaceRoleBadge } from "../peerSettings.logic";
import { PeerSettingsPage } from "../PeerSettingsPage";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsView } from "../useSettingsView";
import { DomainsSection } from "../WorkspaceGeneralDomains";
import { NameField, WorkspaceRows } from "../WorkspaceGeneralParts";

/**
 * A workspace's General page (design artboard 14): its name and the email domains that let colleagues
 * in on their own. Admins rename the workspace; only owners change domains; everyone else reads. The
 * name and the domains are the Hub's own calls and take effect at once. Without the settings feature
 * on the Hub the page shows what the manifest says and nothing is editable.
 */
export function WorkspaceGeneral({ environmentId, status, workspace }: WorkspacePageProps) {
  const view = useSettingsView(workspace.slug);
  const rename = useAtomCommand(serverEnvironment.peerSettings.updateWorkspace, {
    reportFailure: false,
  });
  const sync = useAtomCommand(serverEnvironment.peerHubSync, { reportFailure: false });
  const admin = isWorkspaceAdmin(workspace.role);
  const available = view.hubHasSettings;
  const document = available ? view.document : null;

  const saveName = async (name: string): Promise<string | null> => {
    const result = await rename({ environmentId, input: { workspace: workspace.slug, name } });
    const failure = failureMessage(result);
    if (failure !== null) return failure;
    void sync({ environmentId, input: {} });
    return null;
  };

  return (
    <PeerSettingsPage
      title="General"
      mark={<ProjectMark name={workspace.name} colorKey={workspace.slug} className="size-7" />}
      badge={workspaceRoleBadge(workspace.role, ownLimit(workspace))}
    >
      <div className="flex max-w-3xl flex-col gap-7">
        <SettingsUnavailableNote />
        {view.error === null || document !== null ? null : (
          <SettingsReadError project={workspace.name} error={view.error} onRetry={view.refresh} />
        )}

        <NameField
          name={workspace.name}
          editable={available && admin}
          note={available && !admin ? "Owners and admins change the name." : undefined}
          onSave={saveName}
        />

        <SettingsSearchTarget id={EMAIL_DOMAINS_TARGET} className="outline-none">
          <PageSection
            title="Email domains"
            description={`People with an address here can get into ${workspace.name} without an invite. Only owners change domains.`}
          >
            <DomainsSection
              environmentId={environmentId}
              status={status}
              workspace={workspace}
              owner={workspace.role === "owner"}
              available={available}
            />
          </PageSection>
        </SettingsSearchTarget>

        <WorkspaceRows
          environmentId={environmentId}
          status={status}
          workspace={workspace}
          revision={view.revision}
        />
      </div>
    </PeerSettingsPage>
  );
}
