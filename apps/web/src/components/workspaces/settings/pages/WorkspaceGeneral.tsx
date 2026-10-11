import { getAt } from "@t3tools/client-runtime/peer-settings";

import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { ProjectMark } from "../../signals";
import { failureMessage } from "../../WorkspaceAccess";
import { NotSaved, OwnersNote, PageSection, SettingsReadError } from "../CapacityCoordinationParts";
import { DraftSaveBar } from "../DraftBar";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin, workspaceRoleBadge } from "../peerSettings.logic";
import { PeerSettingsPage } from "../PeerSettingsPage";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsDraft } from "../useSettingsDraft";
import { useSettingsView } from "../useSettingsView";
import { DomainsSection } from "../WorkspaceGeneralDomains";
import { KnowledgeFields, NameField, WorkspaceRows } from "../WorkspaceGeneralParts";
import { YamlCard } from "../WorkspaceGeneralYaml";
import {
  branchEdit,
  knowledgeStatus,
  knowledgeUseOf,
  knowledgeUseOfManifest,
  readCompany,
  removeCompanyEdit,
  repositoryEdit,
  storeEdit,
  type Edit,
} from "../workspaceGeneral.logic";

/**
 * A workspace's General page (design artboard 14): its name, the email domains that let colleagues
 * in on their own, the company knowledge store, and its settings as YAML to export and import.
 * Admins rename the workspace, set the store and use YAML; only owners change domains; everyone
 * else reads. The store goes into a draft that a review saves, the name and the domains are the
 * Hub's own calls and take effect at once. Without the settings feature on the Hub the page shows
 * what the manifest says and nothing is editable.
 */
export function WorkspaceGeneral({ environmentId, status, workspace }: WorkspacePageProps) {
  const view = useSettingsView(workspace.slug);
  const draft = useSettingsDraft(view, { slice: ["knowledge", "company"] });
  const rename = useAtomCommand(serverEnvironment.peerSettings.updateWorkspace, {
    reportFailure: false,
  });
  const sync = useAtomCommand(serverEnvironment.peerHubSync, { reportFailure: false });
  const admin = isWorkspaceAdmin(workspace.role);
  const available = view.hubHasSettings;
  // The document is what the knowledge fields and the project counts read; until it is read, the manifest's.
  const document = available ? view.document : null;

  const saveName = async (name: string): Promise<string | null> => {
    const result = await rename({ environmentId, input: { workspace: workspace.slug, name } });
    const failure = failureMessage(result);
    if (failure !== null) return failure;
    void sync({ environmentId, input: {} });
    return null;
  };

  const company = readCompany(draft.value);
  const manifestStore = workspace.companyKnowledge;
  const fields =
    document !== null
      ? {
          repository: company?.repository ?? "",
          branch: company?.branch ?? "",
          store: company?.store ?? "",
        }
      : {
          repository: manifestStore?.repository ?? "",
          branch: "",
          store: manifestStore?.path ?? "",
        };
  const canEditKnowledge = document !== null && view.canChange(["knowledge"]);
  const write = (edit: Edit) => draft.set(edit.path, edit.value);
  const use =
    document === null
      ? knowledgeUseOfManifest(workspace.projects)
      : knowledgeUseOf(getAt(document, ["projects"]));

  return (
    <PeerSettingsPage
      title="General"
      mark={<ProjectMark name={workspace.name} colorKey={workspace.slug} className="size-7" />}
      badge={workspaceRoleBadge(workspace.role)}
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

        <PageSection
          title="Company knowledge"
          aside={draft.dirty > 0 ? <NotSaved /> : undefined}
          description="One repository of decisions and conventions every project’s agents can read. Each computer keeps a clone."
        >
          <KnowledgeFields
            values={fields}
            editable={canEditKnowledge}
            onRepository={(repository) => write(repositoryEdit(company, repository))}
            onBranch={(branch) => write(branchEdit(branch))}
            onStore={(store) => write(storeEdit(store))}
            onRemove={() => write(removeCompanyEdit)}
          />
          <p className="text-xs text-muted-foreground">
            {fields.repository === ""
              ? "No company knowledge yet. Add a repository so every project’s agents can read it."
              : knowledgeStatus({
                  clone: manifestStore?.state,
                  error: manifestStore?.error,
                  use,
                })}
          </p>
          {document !== null && !canEditKnowledge ? (
            <OwnersNote owners={view.ownersOf(["knowledge"])} />
          ) : null}
        </PageSection>

        {admin && available ? (
          <YamlCard environmentId={environmentId} workspace={workspace} view={view} />
        ) : null}

        <WorkspaceRows
          environmentId={environmentId}
          status={status}
          workspace={workspace}
          revision={view.revision}
        />
      </div>

      <DraftSaveBar draft={draft} scope={workspace.name} label={`${workspace.name} · General`} />
    </PeerSettingsPage>
  );
}
