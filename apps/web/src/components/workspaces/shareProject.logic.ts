import type { PeerHubStatus, ScopedProjectRef } from "@t3tools/contracts";

/** A project of this computer as "Share a project" lists it. */
export interface ShareRow<Project> {
  readonly project: Project;
  /** Whether the project button names it now. */
  readonly open: boolean;
  /** The workspaces that already hold it; a row with none can be shared. */
  readonly sharedWith: ReadonlyArray<string>;
}

/**
 * This computer's projects with what each one's state is: the open one first, so the choice starts
 * from what the person is looking at, then those to share, then those a workspace already holds.
 */
export function shareRows<
  Project extends Pick<ScopedProjectRef, "environmentId"> & {
    readonly id: ScopedProjectRef["projectId"];
  },
>(
  projects: ReadonlyArray<Project>,
  openRefs: ReadonlyArray<ScopedProjectRef> | null,
  workspaces: PeerHubStatus["workspaces"],
): ReadonlyArray<ShareRow<Project>> {
  const rank = (row: ShareRow<Project>) => (row.open ? 0 : row.sharedWith.length === 0 ? 1 : 2);
  return projects
    .map((project) => ({
      project,
      open: (openRefs ?? []).some(
        (ref) => ref.environmentId === project.environmentId && ref.projectId === project.id,
      ),
      sharedWith: workspaces.flatMap((workspace) =>
        workspace.projects.some((state) =>
          state.repositories.some((repository) => repository.projectId === project.id),
        )
          ? [workspace.name]
          : [],
      ),
    }))
    .toSorted((left, right) => rank(left) - rank(right));
}

/** What a row says under the project's name, if anything. */
export function shareRowNote(row: Pick<ShareRow<unknown>, "open" | "sharedWith">): string | null {
  const workspaces = row.sharedWith.join(", ");
  if (row.sharedWith.length === 0) return row.open ? "Open now" : null;
  return row.open ? `Open now, shared with ${workspaces}` : `Shared with ${workspaces}`;
}
