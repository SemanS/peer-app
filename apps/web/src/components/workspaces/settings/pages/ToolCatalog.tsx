import { getAt } from "@t3tools/client-runtime/peer-settings";
import { useState } from "react";

import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { OwnersNote, SettingsReadError } from "../CapacityCoordinationParts";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { PeerSettingsPage } from "../PeerSettingsPage";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import {
  deleteToolOperation,
  emptyCatalogPage,
  manifestCatalog,
  newToolEdit,
  pauseNote,
  pausesTool,
  peopleUsing,
  readCatalog,
  readProjects,
  readToolValue,
  toolProblems,
  usageEdit,
  type Edit,
} from "../toolCatalog.logic";
import { ToolEditor, type UsageProject } from "../ToolCatalogEditor";
import {
  DeleteToolDialog,
  EditorFooter,
  EditorPanel,
  EmptyCatalog,
  NewToolForm,
  ToolList,
} from "../ToolCatalogParts";
import { useReviewChanges } from "../useReviewChanges";
import { useSettingsDraft } from "../useSettingsDraft";
import { useSettingsView } from "../useSettingsView";

/**
 * A workspace's tool catalog (design artboard 17): the MCP servers its projects can give their
 * agents, each editable by admins (one at a time: a tool with unsaved changes holds the list) and
 * read by the members whose projects use it. A definition goes into a draft and Save opens the
 * review; a change that makes a tool another one to the people who approved it says who it pauses.
 * A project's leads add the tool to their projects and take it out again. Deleting a tool also takes
 * it out of every project, which the confirmation lists. Without the settings feature on the Hub
 * the page lists the tools the manifest gives this computer, read-only.
 */
export function ToolCatalog({ environmentId, workspace }: WorkspacePageProps) {
  const view = useSettingsView(workspace.slug);
  const draft = useSettingsDraft(view);
  const sync = useAtomCommand(serverEnvironment.peerHubSync, { reportFailure: false });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // What a save changes reaches the people's own manifests: ask for them again.
  const refreshManifest = () => void sync({ environmentId, input: {} });
  const review = useReviewChanges({
    scope: workspace.name,
    onSaved: (saved, outcome) => {
      draft.saved(saved, outcome);
      refreshManifest();
    },
    onNothingToSave: draft.discard,
  });
  const removal = useReviewChanges({
    scope: workspace.name,
    onSaved: () => {
      view.refresh();
      setSelected(null);
      refreshManifest();
    },
  });

  const document = view.hubHasSettings ? draft.document : null;
  const manifest = manifestCatalog(workspace.projects);
  const catalog = document === null ? manifest : readCatalog(document);
  const current = catalog.find((tool) => tool.id === selected) ?? catalog[0];
  const admin = isWorkspaceAdmin(workspace.role);
  const canCreate = document !== null && view.canChange(["tools"]);
  const locked = draft.dirty > 0;
  const write = (edit: Edit) => draft.set(edit.path, edit.value);

  const id = current?.id;
  const raw =
    id === undefined
      ? undefined
      : document === null
        ? manifest.find((tool) => tool.id === id)?.raw
        : draft.get(["tools", id]);
  const value = readToolValue(raw);
  const problems = toolProblems(value);
  const valid = Object.keys(problems).length === 0;
  const mayEdit = document !== null && id !== undefined && view.canChange(["tools", id]);

  const projects: ReadonlyArray<UsageProject> =
    id === undefined || current === undefined
      ? []
      : document === null
        ? current.projects.map((project) => ({ ...project, uses: true, mayChange: false }))
        : readProjects(document).map((project) => ({
            id: project.id,
            name: project.name,
            uses: project.tools.includes(id),
            mayChange: view.canChange(["projects", project.id, "tools"]),
          }));

  // Who is paused is who has the saved tool now, which is not what the draft would give it to.
  const savedUsers =
    id === undefined || view.document === null
      ? []
      : readProjects(view.document).filter((project) => project.tools.includes(id));
  const savedTool = id === undefined ? undefined : getAt(view.document, ["tools", id]);
  const note =
    id === undefined || savedTool === undefined || !pausesTool(readToolValue(savedTool), value)
      ? null
      : pauseNote({
          tool: value.name || id,
          people: peopleUsing(savedUsers, view.people.length),
          projects: savedUsers.map((project) => project.name),
        });

  const loading = view.hubHasSettings && document === null && view.error === null;
  const canDelete =
    mayEdit && view.document !== null && view.revision !== null && savedTool !== undefined;

  return (
    <PeerSettingsPage
      title="Tools"
      description={`MCP servers ${workspace.name}’s projects can give their agents. Projects pick from this catalog.`}
    >
      <SettingsUnavailableNote />
      {view.error === null || document !== null ? null : (
        <SettingsReadError project={workspace.name} error={view.error} onRetry={view.refresh} />
      )}
      {document !== null && !canCreate ? <OwnersNote owners={view.ownersOf(["tools"])} /> : null}
      {!view.hubHasSettings && !admin && catalog.length > 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          These are the tools your projects use.
        </p>
      ) : null}

      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reading {workspace.name}’s tools…
        </p>
      ) : catalog.length === 0 && !creating ? (
        document === null ? null : canCreate ? (
          <div className="max-w-2xl">
            <EmptyCatalog page={emptyCatalogPage(workspace.name)} onAdd={() => setCreating(true)} />
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            No tools are available to your projects yet.
          </p>
        )
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <div className="max-w-80 min-w-56 flex-1 basis-64">
            <ToolList
              tools={catalog}
              selectedId={creating ? null : (current?.id ?? null)}
              notSaved={(toolId) => draft.changed(["tools", toolId])}
              locked={locked}
              canCreate={canCreate}
              onSelect={(toolId) => {
                setSelected(toolId);
                setCreating(false);
              }}
              onNew={() => setCreating(true)}
            />
          </div>
          <div className="max-w-2xl min-w-0 flex-[2] basis-[28.75rem]">
            {creating ? (
              <NewToolForm
                taken={new Set(catalog.map((tool) => tool.id))}
                onCreate={(newId, name) => {
                  write(newToolEdit(newId, name));
                  setSelected(newId);
                  setCreating(false);
                }}
                onCancel={() => setCreating(false)}
              />
            ) : id === undefined ? null : (
              <EditorPanel label={value.name || id}>
                <ToolEditor
                  key={id}
                  workspace={workspace.slug}
                  id={id}
                  raw={raw}
                  value={value}
                  problems={problems}
                  editable={mayEdit}
                  projects={projects}
                  onEdit={write}
                  onUse={(project, use) => {
                    if (document !== null) write(usageEdit(document, project.id, id, use));
                  }}
                  footer={
                    mayEdit || projects.some((project) => project.mayChange) ? (
                      <EditorFooter
                        note={note}
                        dirty={locked}
                        valid={valid}
                        stale={draft.stale}
                        onSave={() => review.open(draft.operation)}
                        onCancel={draft.discard}
                        onDelete={canDelete ? () => setDeleting(true) : undefined}
                      />
                    ) : null
                  }
                />
              </EditorPanel>
            )}
          </div>
        </div>
      )}

      {deleting && id !== undefined && view.document !== null && view.revision !== null ? (
        <DeleteToolDialog
          tool={value.name || id}
          projects={savedUsers.map((project) => project.name)}
          unsaved={locked}
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            if (view.document === null || view.revision === null) return;
            setDeleting(false);
            // The change deletes what is saved, so what was half edited goes.
            draft.discard();
            removal.open(
              deleteToolOperation({
                workspace: workspace.slug,
                base: view.revision,
                document: view.document,
                id,
              }),
              {
                scope: workspace.name,
                context: `Deleting ${value.name || id} from the catalog${
                  savedUsers.length === 0 ? "" : " and from the projects that use it"
                }.`,
              },
            );
          }}
        />
      ) : null}
      {review.dialog}
      {removal.dialog}
    </PeerSettingsPage>
  );
}
