/**
 * The words Peer's views use for a thread's, an agent's or a project's version control: bookmark,
 * workspace and change for a colocated Jujutsu repository, branch, worktree and commit for Git.
 * Upstream's terminology decides them; an absent kind (an older Peer or Hub) is Git.
 */
import { getVcsTerminology, type VcsTerminology } from "@t3tools/shared/vcs";

export type PeerVcsKind = "git" | "jj";

export const vcsWords = (kind: PeerVcsKind | null | undefined): VcsTerminology =>
  getVcsTerminology(kind);

/** A project's kind on this computer: Jujutsu when one of its ready checkouts is. */
export const projectVcs = (
  repositories: ReadonlyArray<{ readonly vcs?: PeerVcsKind | undefined }>,
): PeerVcsKind => (repositories.some((repository) => repository.vcs === "jj") ? "jj" : "git");
