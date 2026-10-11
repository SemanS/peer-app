import { getAt } from "@t3tools/client-runtime/peer-settings";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../ui/button";
import { DraftSaveBar } from "../DraftBar";
import type { ProjectPageProps } from "../pageProps";
import { useOpenPeerSettings } from "../peerSettingsLinks";
import {
  AddPeoplePanel,
  LeadDisclosure,
  PeopleTable,
  RemovePersonDialog,
  WhoSwitch,
} from "../ProjectPeopleParts";
import {
  addPeople,
  customAllocation,
  leadNamesOf,
  leadsOf,
  membersForMode,
  membersOf,
  modeText,
  peopleModel,
  peopleNotes,
  readOnlyPeopleNote,
  removalWords,
  removePerson,
  toggleLead,
  type PeopleRow,
  type WhoMode,
} from "../projectPeople.logic";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsDraft } from "../useSettingsDraft";
import { useSettingsView } from "../useSettingsView";

/**
 * A project's People tab (design artboard 04): whether the whole workspace or named people are on
 * the project, who they are with their allocation, and who leads. Leads and admins change it in a
 * draft that is saved through the review; everyone else reads it, with who may change it named.
 * Allocations are not edited here: their amounts open the Capacity tab.
 */
export function ProjectPeople({ workspace, state }: ProjectPageProps) {
  const { project } = state;
  const view = useSettingsView(workspace.slug);
  const draft = useSettingsDraft(view, { slice: ["projects", project.id] });
  const open = useOpenPeerSettings();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PeopleRow | null>(null);

  const saved = view.document === null ? undefined : getAt(view.document, ["projects", project.id]);
  const entry = draft.value;
  const model = peopleModel({
    entry,
    people: view.people,
    me: view.me,
    currency: workspace.currency,
    manifest: { members: project.members, role: project.role },
  });
  const editable =
    view.hubHasSettings &&
    view.document !== null &&
    view.canChange(["projects", project.id, "members"]);
  const admin = view.rights?.admin === true || view.rights?.owner === true;

  const setMode = (mode: WhoMode) => {
    if (!editable || model.mode === null || mode === model.mode) return;
    draft.set(["members"], membersForMode(mode, { entry, saved, me: view.me }));
    setAdding(false);
  };
  const remove = (row: PeopleRow) => {
    const removal = removePerson(entry, row.email);
    draft.set(["members"], removal.members);
    draft.set(["leads"], removal.leads);
    if (removal.allocations !== undefined) {
      draft.set(["capacity", "shared", "allocations"], removal.allocations);
    }
  };
  const openPeople = () =>
    void open({ kind: "workspace", workspace: workspace.slug, section: "people" });
  const openCapacity = () =>
    void open({
      kind: "project",
      workspace: workspace.slug,
      projectId: project.id,
      tab: "capacity",
    });

  return (
    <>
      <section aria-labelledby="who-heading" className="flex flex-col gap-2.5">
        <h2 id="who-heading" className="text-sm font-semibold text-foreground">
          Who’s on {project.name}
        </h2>
        {model.mode === null ? null : (
          <>
            <WhoSwitch
              label={`Who’s on ${project.name}`}
              mode={model.mode}
              disabled={!editable}
              onChange={setMode}
            />
            <p className="text-sm text-muted-foreground">
              {modeText({
                mode: model.mode,
                projectName: project.name,
                workspaceName: workspace.name,
                workspaceSize: view.people.length,
              })}
            </p>
          </>
        )}
        <SettingsUnavailableNote />
        {view.error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {view.error}
          </p>
        )}
      </section>

      <section aria-labelledby="people-heading" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 id="people-heading" className="text-sm font-semibold text-foreground">
            People <span className="font-normal text-muted-foreground">{model.count}</span>
          </h2>
          {editable && model.mode === "selected" ? (
            <Button
              size="sm"
              variant="outline"
              aria-expanded={adding}
              onClick={() => setAdding(!adding)}
            >
              <PlusIcon aria-hidden />
              Add people
            </Button>
          ) : null}
        </div>
        {adding && editable && model.mode === "selected" ? (
          <AddPeoplePanel
            workspaceName={workspace.name}
            people={view.people}
            taken={membersOf(entry)}
            onAdd={(email) => draft.set(["members"], addPeople(membersOf(entry), [email]))}
            onOpenPeople={openPeople}
          />
        ) : null}
        <PeopleTable
          rows={model.rows}
          projectName={project.name}
          workspaceName={workspace.name}
          more={model.more}
          editable={editable}
          removable={model.mode === "selected"}
          onToggleLead={(row) => draft.set(["leads"], toggleLead(leadsOf(entry), row.email))}
          onAskRemove={setRemoving}
          onOpenCapacity={openCapacity}
        />
        {view.document !== null && view.hubHasSettings && !editable ? (
          <p className="text-sm text-muted-foreground">
            {readOnlyPeopleNote(
              project.name,
              leadNamesOf(saved, (person) => view.nameOf(person)),
            )}
          </p>
        ) : null}
        <LeadDisclosure projectName={project.name} workspaceName={workspace.name} />
      </section>

      {removing === null ? null : (
        <RemovePersonDialog
          words={removalWords({
            projectName: project.name,
            workspaceName: workspace.name,
            person: { name: removing.name, you: removing.you },
            sharedCapacity: project.capacity.shared !== undefined,
            allocation: customAllocation(entry, removing.email, workspace.currency),
          })}
          onConfirm={() => {
            remove(removing);
            setRemoving(null);
          }}
          onClose={() => setRemoving(null)}
        />
      )}

      <DraftSaveBar
        draft={draft}
        scope={project.name}
        label={`${project.name} · People`}
        notes={peopleNotes({
          projectName: project.name,
          workspaceName: workspace.name,
          saved,
          draft: entry,
          me: view.me,
          admin,
        })}
      />
    </>
  );
}
