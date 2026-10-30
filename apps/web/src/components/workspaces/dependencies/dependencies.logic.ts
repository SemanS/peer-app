import { blockers, projectDependencyIndex } from "@t3tools/client-runtime/peer/dependencies";
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
