import { blockers, projectDependencyIndex } from "@t3tools/client-runtime/peer/dependencies";
import {
  dependentsReadiness,
  dependsOnReadiness,
  readinessFacts,
  readinessLine,
} from "@t3tools/client-runtime/peer/readiness";
import type { PeerHubStatus, PeerProjectState } from "@t3tools/contracts";

export {
  blockers as blockedBy,
  blockedLabel,
  candidates,
  cycleSentence,
  dependenciesOf,
  neededBy,
  projectDependencyIndex,
  stateWord,
  dependencyName,
} from "@t3tools/client-runtime/peer/dependencies";
/** Whether work the task depends on is still open, as a row says it in one word. */
export function taskBlocked(
  status: PeerHubStatus,
  workspace: string,
  project: PeerProjectState | undefined,
  task: string,
): boolean {
  if (project === undefined) return false;
  const snapshot = status.dependencies?.find((candidate) => candidate.workspace === workspace);
  return blockers(snapshot, project.project.id, task, projectDependencyIndex(project)).length > 0;
}

export const toggleInput = (id: string, checked: boolean) =>
  checked ? { remove: [id] } : { add: [id] };

/**
 * A task's dependencies as its page lists them, each with what it still lacks ("VL1 · shared in
 * flight", "VL4 · not yet delivered") and when the task is ready, and its dependents with what else
 * each waits for. Null where the dependencies plugin is off for the workspace.
 */
export function dependencyRows(
  status: Pick<PeerHubStatus, "dependencies" | "handoff" | "acceptance">,
  workspace: string,
  project: PeerProjectState,
  task: string,
) {
  const snapshot = status.dependencies?.find((candidate) => candidate.workspace === workspace);
  if (snapshot?.available !== true) return null;
  const projectId = project.project.id;
  const index = projectDependencyIndex(project);
  const facts = readinessFacts(status, workspace, projectId);
  const on = dependsOnReadiness(snapshot, projectId, task, index, facts);
  return {
    dependsOn: on.rows.map((row) => ({ id: row.task.id, line: readinessLine(row) })),
    readyWhen: on.readyWhen,
    neededBy: dependentsReadiness(snapshot, projectId, task, index, facts).map((group) => ({
      key: group.dependents.map((dependent) => dependent.id).join(","),
      line: group.line,
    })),
  };
}
