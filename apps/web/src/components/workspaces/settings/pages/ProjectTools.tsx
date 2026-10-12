import { toolTrustReview } from "@t3tools/client-runtime/peer-tool-trust";
import { getAt, readDocument } from "@t3tools/client-runtime/peer-settings";
import { useId, useMemo } from "react";

import { DraftSaveBar } from "../DraftBar";
import type { ProjectPageProps } from "../pageProps";
import { useOpenPeerSettings } from "../peerSettingsLinks";
import {
  addFromCatalogState,
  addTool,
  catalogDefinitions,
  manifestDefinition,
  removeTool,
  setToolEnv,
  toolChanges,
  toolEntries,
  toolNotes,
  toolRow,
  type ToolDefinition,
} from "../projectTools.logic";
import { CatalogMenu, ToolList, type ToolListItem } from "../ProjectToolsParts";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsDraft } from "../useSettingsDraft";
import { useSettingsView } from "../useSettingsView";

const NO_CATALOG: ReadonlyMap<string, ToolDefinition> = new Map();

/**
 * A project's Tools tab: the MCP servers its agents get, each with what this computer says of it
 * (approved here or not, its secrets, the commands it needs) and the project's own settings for it.
 * Leads and admins add tools from the workspace catalog and remove them, and give a local tool
 * settings; everyone else reads them, with the owners named. Without the settings feature on the
 * Hub the list is the manifest's, read-only. Approval, secrets and commands are this computer's,
 * so they show either way.
 *
 * A tool's version ("v3 · workspace definition") is left out: the settings view does not carry how
 * many revisions changed a tool.
 */
export function ProjectTools({ status, workspace, state }: ProjectPageProps) {
  const { project } = state;
  const view = useSettingsView(workspace.slug);
  const draft = useSettingsDraft(view, { slice: ["projects", project.id] });
  const open = useOpenPeerSettings();
  const headingId = useId();

  // The catalog is not edited here, so it is read from what is saved, once for each revision.
  const saved = view.document;
  const catalog = useMemo(
    () => (saved === null ? NO_CATALOG : catalogDefinitions(readDocument(saved).tools)),
    [saved],
  );
  const path = ["projects", project.id, "tools"];
  // The document has the project once it is read; until then, and without the settings feature,
  // the page shows the manifest's tools and nothing can be changed.
  const inDocument = draft.value !== undefined;
  const mayChange = view.hubHasSettings && inDocument && view.canChange(path);
  const entries = inDocument
    ? toolEntries(draft.get(["tools"]))
    : project.tools.map((tool) => ({ id: tool.id, env: {} }));
  const savedEntries = toolEntries(
    saved === null ? undefined : getAt(saved, ["projects", project.id, "tools"]),
  );
  const unsaved = draft.dirty > 0;

  const trust = toolTrustReview(status).find((group) => group.workspace === workspace.slug);
  const secrets =
    status.toolTrust?.workspaces.find((entry) => entry.workspace === workspace.slug)?.secrets ?? [];
  const items: ReadonlyArray<ToolListItem> = entries.map((entry) => {
    const manifest = project.tools.find((tool) => tool.id === entry.id);
    return {
      tool: toolRow({
        entry,
        definition:
          (inDocument ? catalog.get(entry.id) : undefined) ??
          (manifest === undefined ? undefined : manifestDefinition(manifest)),
        seen: manifest?.requires.map((requirement) => requirement.command),
        trust: trust?.tools.find(
          (candidate) => candidate.tool === entry.id && candidate.projectIds.includes(project.id),
        ),
        secrets,
        missing:
          state.tools.find((tool) => tool.id === entry.id)?.missing.map((item) => item.command) ??
          [],
      }),
      notSaved: unsaved && !savedEntries.some((savedEntry) => savedEntry.id === entry.id),
    };
  });
  const nameOf = (id: string) => items.find((item) => item.tool.id === id)?.tool.name ?? id;
  const changes = toolChanges(savedEntries, entries);

  const change = (next: ReadonlyArray<unknown>) => draft.set(["tools"], next);
  return (
    <>
      <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 id={headingId} className="text-sm font-semibold text-foreground">
            Tools for {project.name}’s agents
          </h2>
          {mayChange ? (
            <div className="ms-auto">
              <CatalogMenu
                state={addFromCatalogState({
                  workspaceName: workspace.name,
                  loading: saved === null,
                  catalog,
                  used: entries.map((entry) => entry.id),
                  canEditCatalog: view.canChange(["tools"]),
                })}
                onAdd={(id) => change(addTool(draft.get(["tools"]), id))}
                onOpenCatalog={() =>
                  void open({ kind: "workspace", workspace: workspace.slug, section: "tools" })
                }
              />
            </div>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          MCP servers agents get in {project.name}. Each person approves a tool on their own
          computer, and again whenever its definition changes.
        </p>
        {!view.hubHasSettings ? (
          <SettingsUnavailableNote />
        ) : inDocument && !mayChange ? (
          <p role="status" className="text-sm text-muted-foreground">
            {view.ownersOf(path)} change this.
          </p>
        ) : null}
        {view.error === null ? null : (
          <p role="alert" className="text-sm text-destructive-foreground">
            {view.error}
          </p>
        )}
        <ToolList
          items={items}
          projectName={project.name}
          editable={mayChange}
          onRemove={(id) => change(removeTool(draft.get(["tools"]), id))}
          onEnv={(id, env) => change(setToolEnv(draft.get(["tools"]), id, env))}
          onAction={() => void open({ kind: "computer", section: "tool-trust" })}
        />
      </section>
      <DraftSaveBar
        draft={draft}
        scope={project.name}
        label={`${project.name} · Tools`}
        notes={
          unsaved
            ? toolNotes({
                added: changes.added.map(nameOf),
                changed: changes.changed.map(nameOf),
                people: project.members.length,
              })
            : []
        }
      />
    </>
  );
}
