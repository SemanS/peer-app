import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { SettingsSearchTarget, SettingsSection } from "../../../settings/settingsLayout";
import { EMAIL_DOMAINS_TARGET } from "../../workspaceAccess.logic";
import { ProjectMark } from "../../signals";
import { failureMessage } from "../../WorkspaceAccess";
import { PageSection, SettingsReadError } from "../CapacityCoordinationParts";
import { GitHubChecksCard } from "../IntegrationsGitHub";
import type { WorkspacePageProps } from "../pageProps";
import { ownLimit } from "../../workspaceMembers.logic";
import { GITHUB_ANCHOR, isWorkspaceAdmin, workspaceRoleBadge } from "../peerSettings.logic";
import { PeerSettingsPage, RequirePlugin } from "../PeerSettingsPage";
import { HostedWorkspaceSettings } from "../PluginSlots";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsView } from "../useSettingsView";
import { DomainsSection } from "../WorkspaceGeneralDomains";
import { NameField, WorkspaceRows } from "../WorkspaceGeneralParts";
import { YamlCard } from "../WorkspaceGeneralYaml";

/**
 * A workspace's General page (design artboard 14): its name, the email domains that let colleagues
 * in on their own, its settings as YAML to export and import, and for admins GitHub's PR checks
 * (against a Hub without the settings feature, the setup they always had). Admins rename the
 * workspace and use YAML; only owners change domains; everyone else reads. The name and the domains
 * are the Hub's own calls and take effect at once. Without the settings feature on the Hub the page
 * shows what the manifest says and nothing is editable.
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

        {admin && available ? (
          <YamlCard environmentId={environmentId} workspace={workspace} view={view} />
        ) : null}

        {admin ? (
          <RequirePlugin status={status} plugin="github" title="GitHub">
            <SettingsSearchTarget id={GITHUB_ANCHOR}>
              {available ? (
                <GitHubChecksCard
                  environmentId={environmentId}
                  status={status}
                  workspace={workspace}
                />
              ) : (
                <SettingsSection title="GitHub" hideTitle>
                  <HostedWorkspaceSettings
                    host="github"
                    environmentId={environmentId}
                    status={status}
                    workspace={workspace}
                  />
                </SettingsSection>
              )}
            </SettingsSearchTarget>
          </RequirePlugin>
        ) : null}

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
