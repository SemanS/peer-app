import { projectVcs, type PeerVcsKind } from "@t3tools/client-runtime/peer/vcsWords";

/** The part of `PeerHubStatus` that says each project's checkouts on this computer. */
export interface PeerProjectCheckoutsView {
  readonly workspaces: ReadonlyArray<{
    readonly slug: string;
    readonly projects: ReadonlyArray<{
      readonly project: { readonly id: string };
      readonly repositories: ReadonlyArray<{ readonly vcs?: PeerVcsKind | undefined }>;
    }>;
  }>;
}

/**
 * What the advice reads, by the kinds of the predicted pairs' projects on this computer: tips of
 * branches under Git, the changes bookmarks point at under jj. A project this computer no longer
 * lists counts as Git.
 */
export function forecastAdviceText(
  status: PeerProjectCheckoutsView,
  pairs: ReadonlyArray<{ readonly workspace: string; readonly project: string }>,
): string {
  const kinds = new Set<PeerVcsKind>(
    pairs.map((pair) => {
      const project = status.workspaces
        .find((workspace) => workspace.slug === pair.workspace)
        ?.projects.find((candidate) => candidate.project.id === pair.project);
      return projectVcs(project?.repositories ?? []);
    }),
  );
  if (!kinds.has("jj")) return "Advice from committed tips.";
  return kinds.has("git")
    ? "Advice from committed tips and bookmarked changes."
    : "Advice from bookmarked changes.";
}
