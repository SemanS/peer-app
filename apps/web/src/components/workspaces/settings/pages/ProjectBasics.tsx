import { getAt } from "@t3tools/client-runtime/peer-settings";
import type { PeerSettingsSaved } from "@t3tools/contracts";
import { useState } from "react";

import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { Button } from "../../../ui/button";
import { toastManager } from "../../../ui/toast";
import { DraftSaveBar } from "../DraftBar";
import type { ProjectPageProps } from "../pageProps";
import { useOpenPeerSettings } from "../peerSettingsLinks";
import {
  ClientField,
  DeleteProjectDialog,
  DescriptionField,
  NameField,
  ProjectIdField,
} from "../ProjectBasicsParts";
import {
  basicsReadOnlyNote,
  basicsValues,
  deleteConsequences,
  deleteOperation,
} from "../projectBasics.logic";
import { leadNamesOf } from "../projectPeople.logic";
import { savedTitle } from "../reviewChanges.logic";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useReviewChanges } from "../useReviewChanges";
import { useSettingsDraft } from "../useSettingsDraft";
import { useSettingsView } from "../useSettingsView";

/**
 * A project's Basics tab (design artboard 05): its name, client and description, and deleting it.
 * Leads and admins change the form in a draft that is saved through the review; everyone else reads it, with who may
 * change it named. Deleting asks for the project's id, then goes through the same review, and
 * leaves for the workspace's General page once it is saved.
 */
export function ProjectBasics({ environmentId, workspace, state }: ProjectPageProps) {
  const { project } = state;
  const path = ["projects", project.id] as const;
  const view = useSettingsView(workspace.slug);
  const draft = useSettingsDraft(view, { slice: path });
  const open = useOpenPeerSettings();
  const sync = useAtomCommand(serverEnvironment.peerHubSync, { reportFailure: false });
  const [deleting, setDeleting] = useState(false);

  // The project no longer exists once its deletion is saved, and with it this page: the person
  // leaves for the workspace, and what the review would have said is said in a toast.
  const review = useReviewChanges({
    scope: project.name,
    onSaved: (saved: PeerSettingsSaved) => {
      toastManager.add({
        type: "success",
        title: `Deleted ${project.name}`,
        description: savedTitle(saved),
      });
      view.refresh();
      void sync({ environmentId, input: {} });
      void open(
        { kind: "workspace", workspace: workspace.slug, section: "general" },
        { replace: true },
      );
    },
  });

  const entry = draft.value;
  const values = basicsValues(entry, project);
  const editable = view.hubHasSettings && view.document !== null && view.canChange(path);
  const readOnlyNote =
    view.hubHasSettings && view.document !== null && !editable
      ? basicsReadOnlyNote(
          view.ownersOf(path),
          leadNamesOf(getAt(view.document, path), (person) => view.nameOf(person)),
        )
      : null;

  return (
    <>
      <div className="flex max-w-3xl flex-col gap-7">
        <section aria-label="Basics" className="flex flex-col gap-4">
          <SettingsUnavailableNote />
          {readOnlyNote === null ? null : (
            <p role="status" className="text-sm text-muted-foreground">
              {readOnlyNote}
            </p>
          )}
          {view.error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {view.error}
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3.5">
            <NameField
              value={values.name}
              disabled={!editable}
              onCommit={(name) => draft.set(["name"], name)}
            />
            <ProjectIdField id={project.id} projectName={project.name} />
          </div>
          <ClientField
            // oxlint-disable-next-line t3code/no-rpc-permission-bypass -- `client` is the project's customer, not an RPC client.
            value={values.client}
            disabled={!editable}
            onCommit={(client) => draft.set(["client"], client)}
          />
          <DescriptionField
            value={values.description}
            disabled={!editable}
            onCommit={(description) => draft.set(["description"], description)}
          />
        </section>

        <section
          aria-labelledby="delete-heading"
          className="flex flex-col gap-2.5 border-t border-border pt-5"
        >
          <h2 id="delete-heading" className="text-sm font-semibold text-foreground">
            Delete project
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-60 flex-1 text-sm text-muted-foreground">
              Removes {project.name} for everyone. Leads and admins can do this.
            </p>
            <Button
              variant="destructive-outline"
              disabled={!editable || view.revision === null}
              onClick={() => setDeleting(true)}
            >
              Delete {project.name}…
            </Button>
          </div>
        </section>
      </div>

      {deleting && view.revision !== null ? (
        <DeleteProjectDialog
          project={project}
          consequences={deleteConsequences(project, {
            tasks: state.work.tasks.length,
            areas: state.work.areas.length,
            people: project.members.length,
          })}
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            if (view.revision === null) return;
            review.open(deleteOperation(workspace.slug, view.revision, project.id), {
              scope: project.name,
              context: "Deleting the project for everyone.",
            });
          }}
        />
      ) : null}
      {review.dialog}

      <DraftSaveBar draft={draft} scope={project.name} label={`${project.name} · Basics`} />
    </>
  );
}
