import { EnvironmentId, type PeerHubStatus, type ScopedProjectRef } from "@t3tools/contracts";

import { projectScopeKey } from "./workBoard.logic";

/**
 * A workspace project as the sidebar's project scope knows it: its scope key, its name, and the
 * projects of this computer that hold its repositories, whose chats belong to it.
 */
export interface PeerProjectEntry {
  /** `<workspace>/<project>`, the key the Work views share (`peer:work-scope`). */
  readonly scope: string;
  readonly name: string;
  readonly refs: ReadonlyArray<ScopedProjectRef>;
}

/**
 * Every workspace project of the Hub's status, with where its repositories are open on this
 * computer. A repository not cloned yet has no project here, so a project with none has no chats.
 */
export function peerProjectIndex(
  status: Pick<PeerHubStatus, "environmentId" | "workspaces"> | null,
): ReadonlyArray<PeerProjectEntry> {
  if (status === null) return [];
  const environmentId =
    status.environmentId.trim() === "" ? null : EnvironmentId.make(status.environmentId);
  return status.workspaces.flatMap((workspace) =>
    workspace.projects.map((state): PeerProjectEntry => ({
      scope: projectScopeKey({ workspace: workspace.slug, projectId: state.project.id }),
      name: state.project.name,
      refs: state.repositories.flatMap((repository) =>
        environmentId === null || repository.projectId === undefined
          ? []
          : [{ environmentId, projectId: repository.projectId }],
      ),
    })),
  );
}
