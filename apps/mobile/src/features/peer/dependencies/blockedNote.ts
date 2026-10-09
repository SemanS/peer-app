import {
  blockers,
  dependencyName,
  projectDependencyIndex,
} from "@t3tools/client-runtime/peer/dependencies";
import type { PeerHubStatus, PeerTask, PeerWorkThread } from "@t3tools/contracts";
export function blockedNote({
  status,
  workspace,
  project,
  task,
}: {
  readonly status: Pick<PeerHubStatus, "dependencies">;
  readonly workspace: string;
  readonly project: {
    readonly project: { readonly id: string };
    readonly work: {
      readonly tasks: ReadonlyArray<PeerTask>;
      readonly threads: ReadonlyArray<PeerWorkThread>;
    };
  };
  readonly task: PeerTask;
}) {
  const on = blockers(
    status.dependencies?.find((s) => s.workspace === workspace),
    project.project.id,
    task.id,
    projectDependencyIndex(project),
  );
  return on.length
    ? `· blocked by ${dependencyName(on[0]!.task)}${on.length > 1 ? ` +${on.length - 1}` : ""}`
    : null;
}
