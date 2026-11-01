import { getAt } from "@t3tools/client-runtime/peer-settings";

import { OwnersNote, PageSection, SettingsReadError } from "../CapacityCoordinationParts";
import { DraftSaveBar } from "../DraftBar";
import type { ProjectPageProps } from "../pageProps";
import { PolicyList } from "../ProjectCoordinationParts";
import {
  choiceEdit,
  choiceOf,
  readCoordination,
  type CoordinationSettings,
  type Edit,
} from "../projectCoordination.logic";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsDraft } from "../useSettingsDraft";
import { useSettingsView } from "../useSettingsView";

/**
 * A project's Coordination tab (design artboard 11): the policy its agents follow when one wants to
 * edit a file someone else's agent is on. Leads and admins change it; members read. Edits go into one
 * draft of the project's node that a review saves. Where the Hub has no settings, the page shows the
 * policy the status says, and nothing is editable.
 */
export function ProjectCoordination({ status, workspace, state }: ProjectPageProps) {
  const { project } = state;
  const view = useSettingsView(workspace.slug);
  const draft = useSettingsDraft(view, { slice: ["projects", project.id] });

  // The draft's settings where they can be read, else what the status says.
  const document = view.hubHasSettings ? draft.document : null;
  const fromSettings = document !== null && getAt(document, ["projects", project.id]) !== undefined;
  const ownPolicies = status.coordination.policies?.[workspace.slug];
  const settings: CoordinationSettings = fromSettings
    ? readCoordination(draft.get(["coordination"]))
    : { policy: ownPolicies?.[project.id] };
  // A project the document does not show cannot be edited, whatever the person's rights say.
  const canEdit = fromSettings && view.canChange(["projects", project.id, "coordination"]);
  const write = (edit: Edit) => draft.set(["coordination", ...edit.path], edit.value);
  const choice = choiceOf(settings.policy);

  return (
    <>
      <SettingsUnavailableNote />
      {view.error === null || fromSettings ? null : (
        <SettingsReadError project={project.name} error={view.error} onRetry={view.refresh} />
      )}
      {/* Without the settings only the policy is known, and only where the status lists it. */}
      {fromSettings || ownPolicies !== undefined ? (
        <PageSection
          title={`Policy for ${project.name}`}
          description="What happens when an agent wants to edit a file someone else’s agent is on."
        >
          <PolicyList
            project={project.name}
            value={choice}
            disabled={!canEdit}
            changed={draft.changed(["coordination", "policy"])}
            onChange={(next) => write(choiceEdit(next))}
          />
          {fromSettings && !canEdit ? (
            <OwnersNote owners={view.ownersOf(["projects", project.id, "coordination"])} />
          ) : null}
        </PageSection>
      ) : null}

      <DraftSaveBar draft={draft} scope={project.name} label={`${project.name} · Coordination`} />
    </>
  );
}
