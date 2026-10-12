import { pathRuleCount } from "@t3tools/client-runtime/peer/resources";
import { getAt } from "@t3tools/client-runtime/peer-settings";

import { OwnersNote, PageSection, SettingsReadError } from "../CapacityCoordinationParts";
import { DraftSaveBar } from "../DraftBar";
import type { ProjectPageProps } from "../pageProps";
import { useOpenPeerSettings } from "../peerSettingsLinks";
import { DecidePanel, PathRules, PathRulesOff, PolicyList } from "../ProjectCoordinationParts";
import {
  addRuleBlocker,
  choiceEdit,
  choiceOf,
  readCoordination,
  removeRuleEdit,
  ruleCountSentence,
  rulesCountText,
  rulesOf,
  setRuleEdit,
  type CoordinationSettings,
  type Edit,
} from "../projectCoordination.logic";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsDraft } from "../useSettingsDraft";
import { useSettingsView } from "../useSettingsView";

/**
 * A project's Coordination tab (design artboard 11): the policy its agents follow when one wants to
 * edit a file someone else's agent is on, the path rules that give parts of the repository a policy
 * of their own, and a panel that says which rule decides for a path. Leads and admins change it;
 * members read. Edits go into a draft that a review saves. Where the Hub has no settings, the page
 * shows the policy and the number of rules the status says, and nothing is editable.
 */
export function ProjectCoordination({ status, workspace, state }: ProjectPageProps) {
  const { project } = state;
  const view = useSettingsView(workspace.slug);
  const draft = useSettingsDraft(view, { slice: ["projects", project.id, "coordination"] });
  const open = useOpenPeerSettings();

  // The draft's settings where they can be read, else what the status says.
  const document = view.hubHasSettings ? draft.document : null;
  const fromSettings = document !== null && getAt(document, ["projects", project.id]) !== undefined;
  const ownPolicies = status.coordination.policies?.[workspace.slug];
  const settings: CoordinationSettings = fromSettings
    ? readCoordination(draft.value)
    : { policy: ownPolicies?.[project.id], paths: {} };
  const rules = rulesOf(settings.paths);
  const count = fromSettings ? rules.length : pathRuleCount(status, workspace.slug, project.id);
  // A project the document does not show cannot be edited, whatever the person's rights say.
  const canEdit = fromSettings && view.canChange(["projects", project.id, "coordination"]);
  const write = (edit: Edit) => draft.set(edit.path, edit.value);
  const choice = choiceOf(settings.policy);

  return (
    <>
      <SettingsUnavailableNote />
      {view.error === null || fromSettings ? null : (
        <SettingsReadError project={project.name} error={view.error} onRetry={view.refresh} />
      )}
      {view.features?.pathRules === false ? (
        <PathRulesOff
          project={project.name}
          onOpenHub={() =>
            void open({ kind: "workspace", workspace: workspace.slug, section: "hub" })
          }
        />
      ) : null}

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
            ruleCount={count}
            changed={draft.changed(["policy"])}
            onChange={(next) => write(choiceEdit(next))}
          />
          {fromSettings && !canEdit ? (
            <OwnersNote owners={view.ownersOf(["projects", project.id, "coordination"])} />
          ) : null}
        </PageSection>
      ) : null}

      {fromSettings ? (
        <>
          <PageSection
            title="Path rules"
            aside={rulesCountText(rules.length)}
            description="Exceptions for parts of the repository. The most specific rule wins; other paths follow the policy above."
          >
            <PathRules
              rules={rules}
              canEdit={canEdit}
              changed={
                new Set(
                  rules
                    .map((rule) => rule.pattern)
                    .filter((pattern) => draft.changed(["paths", pattern])),
                )
              }
              addDisabledReason={addRuleBlocker(settings, project.name)}
              onPolicy={(pattern, policy) => write(setRuleEdit(pattern, policy))}
              onRemove={(pattern) => write(removeRuleEdit(settings.paths, pattern))}
              onAdd={(pattern, policy) => write(setRuleEdit(pattern, policy))}
            />
            <p className="text-xs text-muted-foreground">
              * matches within one folder, ** any depth. An exclusive rule holds every path under it
              as one lock for 30 minutes.
            </p>
          </PageSection>

          <PageSection title="Which rule decides?">
            <DecidePanel
              settings={settings}
              project={{ id: project.id, name: project.name }}
              rulesApply={view.features?.pathRules !== false}
              computer={{
                enabled: status.coordination.enabled,
                policy: status.coordination.policy,
              }}
              onChangeComputer={() => void open({ kind: "computer", section: "coordination" })}
            />
            <p className="text-xs text-muted-foreground">Changes apply from the next file edit.</p>
          </PageSection>
        </>
      ) : count > 0 ? (
        <p className="text-sm text-muted-foreground">{ruleCountSentence(count, project.name)}</p>
      ) : null}

      <DraftSaveBar draft={draft} scope={project.name} label={`${project.name} · Coordination`} />
    </>
  );
}
