import { projectVcs, vcsWords, type PeerVcsKind } from "@t3tools/client-runtime/peer/vcsWords";
/** The part of `PeerHubStatus` that says which projects this computer has checked out, and how. */
export interface PeerCheckoutsView {
  readonly workspaces: ReadonlyArray<{
    readonly projects: ReadonlyArray<{
      readonly repositories: ReadonlyArray<{ readonly vcs?: PeerVcsKind | undefined }>;
    }>;
  }>;
}

/** The kinds of this computer's projects, Git first; Git alone when it has none. */
export function projectVcsKinds(status: PeerCheckoutsView): PeerVcsKind[] {
  const kinds = new Set(
    status.workspaces.flatMap((workspace) =>
      workspace.projects.map((project) => projectVcs(project.repositories)),
    ),
  );
  return kinds.has("jj") ? (kinds.has("git") ? ["git", "jj"] : ["jj"]) : ["git"];
}

/**
 * The auto-index switch, named by what Peer creates for a task: worktrees under Git, workspaces
 * under jj, both when this computer has projects of both kinds.
 */
export function impactAutoIndexText(kinds: ReadonlyArray<PeerVcsKind>): {
  readonly label: string;
  readonly note: string;
} {
  const checkouts = kinds.map((kind) => vcsWords(kind).workspaceNounPlural).join(" and ");
  return {
    label: `Index new Peer task ${checkouts}`,
    note: `Opt in to initialize only new Peer task ${checkouts}. Existing checkouts are never initialized automatically.`,
  };
}
