import { getAt } from "@t3tools/client-runtime/peer-settings";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "../../../ui/button";
import { projectCheckout, useOpenWorkspaceProject } from "../../useOpenWorkspaceProject";
import { DraftSaveBar } from "../DraftBar";
import type { ProjectPageProps } from "../pageProps";
import {
  MAX_REPOSITORIES,
  addRepository,
  cloneView,
  githubChecksOn,
  prVerification,
  removeRepository,
  repositoriesOf,
  setRepositoryBranch,
} from "../projectRepositories.logic";
import {
  AddRepositoryForm,
  RepositoryList,
  type RepositoryRowModel,
} from "../ProjectRepositoriesParts";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsDraft } from "../useSettingsDraft";
import { useSettingsView } from "../useSettingsView";

/**
 * A project's Repositories tab: the repositories agents clone on each computer, each with its
 * branch, whether Peer can confirm its pull requests, and where it stands on this computer, with
 * "Clone & open" for the ones that are not here. Leads and admins change the branch, remove a
 * repository and add one by its Git URL; everyone else reads them, with the owners named. Without
 * the settings feature on the Hub the list is the manifest's, read-only. Cloning is a local action,
 * so it works either way.
 */
export function ProjectRepositories({ environmentId, status, workspace, state }: ProjectPageProps) {
  const { project } = state;
  const view = useSettingsView(workspace.slug);
  const draft = useSettingsDraft(view, { slice: ["projects", project.id] });
  const opener = useOpenWorkspaceProject({
    environmentId,
    workspace: workspace.slug,
    projectId: project.id,
    name: project.name,
  });
  const headingId = useId();
  const [adding, setAdding] = useState(false);

  const path = ["projects", project.id, "repositories"];
  // The document has the project once it is read; until then, and without the settings feature,
  // the page shows the manifest's repositories and nothing can be changed.
  const inDocument = draft.value !== undefined;
  const mayChange = view.hubHasSettings && inDocument && view.canChange(path);
  const listed = inDocument ? repositoriesOf(draft.get(["repositories"])) : project.repositories;
  const saved = repositoriesOf(
    view.document === null
      ? undefined
      : getAt(view.document, ["projects", project.id, "repositories"]),
  );
  const unsaved = draft.dirty > 0;
  const checksOn = githubChecksOn(status, workspace.slug);
  // The first repository holds the project's knowledge, while the project keeps any.
  const knowledge = inDocument
    ? draft.get(["knowledge", "kontext"]) !== false
    : project.knowledge.kontext;
  const rows: ReadonlyArray<RepositoryRowModel> = listed.map((entry, index) => ({
    ...entry,
    knowledge: index === 0 && knowledge,
    notSaved: unsaved && !saved.some((repository) => repository.id === entry.id),
    pr: prVerification(entry.url, checksOn),
    clone: cloneView(state.repositories.find((repository) => repository.id === entry.id)),
  }));
  const busy = projectCheckout(state).cloning || opener.opening;
  const full = listed.length >= MAX_REPOSITORIES;

  const removed = saved.filter((entry) => !listed.some((repository) => repository.id === entry.id));
  const change = (next: ReadonlyArray<unknown>) => draft.set(["repositories"], next);
  return (
    <>
      <div className="flex flex-col gap-5">
        <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id={headingId} className="text-sm font-semibold text-foreground">
              Repositories{" "}
              <span className="font-normal text-muted-foreground">
                {listed.length} of {MAX_REPOSITORIES}
              </span>
            </h2>
            {mayChange ? (
              <Button
                className="ms-auto"
                size="sm"
                variant="outline"
                aria-expanded={adding}
                disabled={full}
                onClick={() => setAdding(!adding)}
              >
                <PlusIcon aria-hidden />
                Add repository
              </Button>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Agents clone these on each computer. Path rules and PR checks follow them.
          </p>
          {!view.hubHasSettings ? (
            <SettingsUnavailableNote />
          ) : inDocument && !mayChange ? (
            <p role="status" className="text-sm text-muted-foreground">
              {view.ownersOf(path)} change this.
            </p>
          ) : null}
          {mayChange && full ? (
            <p role="status" className="text-sm text-muted-foreground">
              A project has up to {MAX_REPOSITORIES} repositories.
            </p>
          ) : null}
          {view.error === null ? null : (
            <p role="alert" className="text-sm text-destructive-foreground">
              {view.error}
            </p>
          )}
          <RepositoryList
            rows={rows}
            editable={mayChange}
            busy={busy}
            onBranch={(id, branch) =>
              change(setRepositoryBranch(draft.get(["repositories"]), id, branch))
            }
            onRemove={(id) => change(removeRepository(draft.get(["repositories"]), id))}
            onClone={() => void opener.open()}
          />
        </section>
        {mayChange && adding && !full ? (
          <AddRepositoryForm
            projectName={project.name}
            takenIds={listed.map((entry) => entry.id)}
            onAdd={(entry) => {
              change(addRepository(draft.get(["repositories"]), entry));
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}
      </div>
      <DraftSaveBar
        draft={draft}
        scope={project.name}
        label={`${project.name} · Repositories`}
        notes={removed.length === 0 ? [] : ["Clones already on people’s computers stay."]}
      />
    </>
  );
}
