import { pathRuleCount } from "@t3tools/client-runtime/peer/resources";
import { getAt } from "@t3tools/client-runtime/peer-settings";

import { useEnvironmentQuery } from "../../../../state/query";
import { serverEnvironment } from "../../../../state/server";
import { OwnersNote, PageSection, SettingsReadError } from "../CapacityCoordinationParts";
import { DraftSaveBar } from "../DraftBar";
import type { ProjectPageProps } from "../pageProps";
import { useOpenPeerSettings } from "../peerSettingsLinks";
import {
  AgentMemoryList,
  DecidePanel,
  MemoryPinNote,
  PathRules,
  PathRulesOff,
  PolicyList,
} from "../ProjectCoordinationParts";
import {
  addRuleBlocker,
  agentMemoryEdit,
  choiceEdit,
  choiceOf,
  readAgentMemory,
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
 * of their own, a panel that says which rule decides for a path, and the project's word on its
 * agents' harness memory. Leads and admins change it; members read. Edits go into one draft of the
 * project's node that a review saves. Where the Hub has no settings, the page shows the policy and
 * the number of rules the status says, and nothing is editable.
 */
export function ProjectCoordination({ environmentId, status, workspace, state }: ProjectPageProps) {
  const { project } = state;
  const view = useSettingsView(workspace.slug);
  // One draft of the project's node: the coordination block and the agents block save together.
  const draft = useSettingsDraft(view, { slice: ["projects", project.id] });
  const open = useOpenPeerSettings();
  const knowledge = useEnvironmentQuery(
    serverEnvironment.peerHubKnowledgeStatus({
      environmentId,
      input: { workspace: workspace.slug, project: project.id },
    }),
  ).data;

  // The draft's settings where they can be read, else what the status says.
  const document = view.hubHasSettings ? draft.document : null;
  const fromSettings = document !== null && getAt(document, ["projects", project.id]) !== undefined;
  const ownPolicies = status.coordination.policies?.[workspace.slug];
  const settings: CoordinationSettings = fromSettings
    ? readCoordination(draft.get(["coordination"]))
    : { policy: ownPolicies?.[project.id], paths: {} };
  const rules = rulesOf(settings.paths);
  const count = fromSettings ? rules.length : pathRuleCount(status, workspace.slug, project.id);
  // A project the document does not show cannot be edited, whatever the person's rights say.
  const canEdit = fromSettings && view.canChange(["projects", project.id, "coordination"]);
  const write = (edit: Edit) => draft.set(["coordination", ...edit.path], edit.value);
  const choice = choiceOf(settings.policy);
  // The agents' memory: shown only where the Hub reads the field, so an older Hub never refuses a save.
  const memoryServed = fromSettings && view.features?.agentMemory === true;
  const memory = readAgentMemory(draft.get(["agents"]));
  const canEditMemory = memoryServed && view.canChange(["projects", project.id, "agents"]);

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
            changed={draft.changed(["coordination", "policy"])}
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
                    .filter((pattern) => draft.changed(["coordination", "paths", pattern])),
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

      {memoryServed ? (
        <PageSection
          title="Agents’ harness memory"
          description="Whether agents working on the project keep a memory of their own in their harness (Claude Code’s auto memory). Applies from each agent’s next session."
        >
          <AgentMemoryList
            project={project.name}
            value={memory}
            disabled={!canEditMemory}
            changed={draft.changed(["agents", "memory"])}
            onChange={(next) => draft.set(agentMemoryEdit(next).path, agentMemoryEdit(next).value)}
          />
          {!canEditMemory ? (
            <OwnersNote owners={view.ownersOf(["projects", project.id, "agents"])} />
          ) : null}
          <MemoryPinNote pinned={knowledge?.harnessMemoryPinned} memory={memory} />
        </PageSection>
      ) : null}

      <DraftSaveBar draft={draft} scope={project.name} label={`${project.name} · Coordination`} />
    </>
  );
}
