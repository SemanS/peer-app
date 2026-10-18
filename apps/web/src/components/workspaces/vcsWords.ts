/**
 * The words Peer's web views use for a ref, a workspace and a change: a thread's own kind where
 * there is a thread, else the kind of this computer's checkouts (design D7). A surface that spans
 * several projects names both kinds when both are in play, so neither project's people read the
 * other's words.
 */
import { projectVcs, vcsWords, type PeerVcsKind } from "@t3tools/client-runtime/peer/vcsWords";
import type { PeerHubStatus } from "@t3tools/contracts";
import type { VcsTerminology } from "@t3tools/shared/vcs";

import type { WorkProjectNode, WorkThreadNode } from "./workTree.logic";

export { projectVcs, vcsWords, type PeerVcsKind };

/** The kinds in play, Git first; nothing known is Git, as an older Peer or Hub sends no kind. */
export function kindsOf(kinds: Iterable<PeerVcsKind | undefined>): ReadonlyArray<PeerVcsKind> {
  const seen = new Set<PeerVcsKind>();
  for (const kind of kinds) seen.add(kind ?? "git");
  if (seen.size === 0) return ["git"];
  return (["git", "jj"] as const).filter((kind) => seen.has(kind));
}

/** The kinds of this computer's ready checkouts, across its workspaces: what settings speak of. */
export const computerKinds = (status: Pick<PeerHubStatus, "workspaces">) =>
  kindsOf(
    status.workspaces.flatMap((workspace) =>
      workspace.projects.flatMap((project) =>
        project.repositories.flatMap((repo) => (repo.state === "ready" ? [repo.vcs] : [])),
      ),
    ),
  );

function threadsOf(project: WorkProjectNode): ReadonlyArray<WorkThreadNode> {
  return [
    ...project.unsorted,
    ...project.areas.flatMap((area) => area.tasks.flatMap((task) => task.threads)),
  ];
}

/** The kinds a board shows: its projects' checkouts here and every thread on it, teammates' too. */
export const boardKinds = (projects: ReadonlyArray<WorkProjectNode>) =>
  kindsOf(projects.flatMap((project) => [project.vcs, ...threadsOf(project).map((t) => t.vcs)]));

type Noun = "refNoun" | "refNounPlural" | "workspaceNoun" | "workspaceNounPlural";

/**
 * One noun for every kind on a surface. Both kinds read "branches, bookmarks"; a jj workspace
 * keeps its "jj", since "worktrees and workspaces" would not say which is which.
 */
export function nounOf(kinds: ReadonlyArray<PeerVcsKind>, noun: Noun, joiner: string): string {
  if (kinds.length !== 2) return vcsWords(kinds[0])[noun];
  const jj = vcsWords("jj")[noun];
  return `${vcsWords("git")[noun]}${joiner}${noun.startsWith("workspace") ? `jj ${jj}` : jj}`;
}

const title = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The task details' ref row: the kinds of the task's threads with a ref, else the project's. */
export function refRowLabel(
  threads: ReadonlyArray<Pick<WorkThreadNode, "branch" | "vcs">>,
  projectKind: PeerVcsKind,
): string {
  const withRef = threads.filter((thread) => thread.branch !== undefined && thread.branch !== "");
  const kinds = withRef.length === 0 ? [projectKind] : kindsOf(withRef.map((t) => t.vcs));
  return title(nounOf(kinds, kinds.length === 2 ? "refNounPlural" : "refNoun", " and "));
}

/** Where a herdr agent of a task starts: its own workspace and ref, from the repository's base. */
export const launchLine = (words: VcsTerminology, base: string) =>
  `a new ${words.workspaceNoun} and ${words.refNoun} from ${base}`;

export const launchNote = (words: VcsTerminology) =>
  `Peer creates a feature ${words.refNoun} in its own ${words.workspaceNoun} on this computer. The running session shows whether its Mod or hooks enforce coordination.`;

/** jj records every edit in the working-copy change, so nothing there is "uncommitted". */
export const observedPathsLine = (kind: PeerVcsKind | undefined, count: number) =>
  kind === "jj"
    ? ` · ${count} paths observed in the working copy`
    : ` · ${count} uncommitted paths observed`;

export const boardSearchPlaceholder = (kinds: ReadonlyArray<PeerVcsKind>) =>
  `Search tasks, chats, ${nounOf(kinds, "refNounPlural", ", ")}, people`;

export const issueKeyHint = (kind: PeerVcsKind) =>
  `From your tracker, such as Jira or Linear. A chat whose ${vcsWords(kind).refNoun} names it joins this task.`;

export const experimentStartStep = (kinds: ReadonlyArray<PeerVcsKind>) =>
  `On both, start that agent in herdr in that checkout, each on a ${nounOf(kinds, "refNoun", " or ")} of its own.`;

export function impactIndexWords(kinds: ReadonlyArray<PeerVcsKind>) {
  const workspaces = nounOf(kinds, "workspaceNounPlural", " and ");
  return {
    title: `Index new Peer task ${workspaces}`,
    description: `Opt in to initialize only newly created Peer task ${workspaces} on this environment. Existing checkouts are never initialized automatically.`,
  };
}

export function forecastTeammatesWords(kinds: ReadonlyArray<PeerVcsKind>) {
  const refs = nounOf(kinds, "refNounPlural", " and ");
  return {
    title: `Forecast teammates’ ${refs}`,
    description: `Fetch only the named ${refs} from origin. Forecasts use ${kinds.includes("jj") ? "their pushed tips" : "committed tips"} and stay on this computer.`,
  };
}
