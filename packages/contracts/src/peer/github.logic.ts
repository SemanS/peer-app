import type { PeerWorkThread } from "./base.ts";

/**
 * What a pull request's list entry says when GitHub's record and its owner's Peer differ, the same
 * in every client and in `peer delivery`. Only a merge that the owner's Peer reports and GitHub's
 * record lacks can mean GitHub missed a delivery, so only that suggests redelivering it. A report
 * that is simply behind (GitHub says merged or closed, the owner's Peer still says open) asks
 * nothing of the person: the note only says that GitHub's record is the one that counts.
 */
function disagreementNote(reported: string, verified: string): string {
  return reported === "merged" && verified !== "merged"
    ? "The owner's Peer reports merged. Redeliver the merge event from the repository's webhook settings if GitHub missed it."
    : `The owner's Peer reports ${reported}. GitHub's state counts.`;
}

export function pullRequestRows(
  threads: ReadonlyArray<PeerWorkThread>,
  taskId: string,
  names: ReadonlyMap<string, string> = new Map(),
) {
  const rows = new Map<
    string,
    {
      url: string;
      number: string;
      state: string;
      reportedState: string;
      source: string;
      headBranch: string;
      baseBranch?: string | undefined;
      mergedAt?: string | undefined;
      closedAt?: string | undefined;
      verifiedAt?: string | undefined;
      mergeCommit?: string | undefined;
      disagreement: boolean;
      /** The line about a disagreement; null while GitHub's record and the report agree. */
      note: string | null;
      verified: boolean;
    }
  >();
  for (const thread of threads.filter((t) => t.task === taskId))
    for (const pr of thread.pullRequests ?? []) {
      const id = pr.url.toLowerCase();
      if (rows.has(id) && (!pr.github || rows.get(id)?.verified)) continue;
      // An owner's Peer that could not read the state ("unknown") made no claim to disagree with.
      const differs =
        pr.github !== undefined && pr.state !== "unknown" && pr.github.state !== pr.state;
      rows.set(id, {
        url: pr.url,
        number: /\/pull\/(\d+)$/i.exec(pr.url)?.[1] ?? pr.url,
        state: pr.github?.state ?? pr.state,
        reportedState: pr.state,
        source: pr.github
          ? "GitHub"
          : `reported by ${names.get(thread.email) ?? thread.email}'s Peer`,
        headBranch: pr.github?.headBranch ?? pr.headBranch,
        baseBranch: pr.github?.baseBranch,
        mergedAt: pr.github?.mergedAt,
        closedAt: pr.github?.closedAt,
        verifiedAt: pr.github?.verifiedAt,
        mergeCommit: pr.github?.mergeCommit,
        disagreement: differs,
        note: differs && pr.github ? disagreementNote(pr.state, pr.github.state) : null,
        verified: pr.github !== undefined,
      });
    }
  return [...rows.values()];
}
export function taskDelivery(threads: ReadonlyArray<PeerWorkThread>, taskId: string) {
  const rows = pullRequestRows(threads, taskId);
  const hosts = new Set<string>();
  for (const thread of threads.filter((t) => t.task === taskId)) {
    const repository = thread.repository;
    if (!repository) continue;
    const host = /^(?:[^@\s]+@)?([^:/\s]+):/.exec(repository)?.[1];
    try {
      const hostname = new URL(repository).hostname;
      if (hostname && hostname !== "github.com") hosts.add(hostname);
    } catch {
      if (host && host !== "github.com") hosts.add(host);
    }
  }
  return {
    total: rows.length,
    merged: rows.filter((r) => r.state === "merged").length,
    verifiedAll: rows.length > 0 && rows.every((r) => r.verified),
    reportedOnly: rows.every((r) => !r.verified),
    closedUnmerged: rows.some((r) => r.state === "closed"),
    disagreements: rows.filter((r) => r.disagreement).length,
    hosts: [...hosts],
  };
}

/**
 * A task's delivery badge: its words, which are also its accessible label, and how loud it is. Once
 * the workspace verifies, the mark says whether GitHub verified every pull request; a pull request
 * closed without merge outranks it, since that is what needs a person.
 */
export function deliveryBadge(
  summary: Pick<
    ReturnType<typeof taskDelivery>,
    "merged" | "total" | "verifiedAll" | "closedUnmerged"
  >,
  verifying: boolean,
) {
  const mark = summary.closedUnmerged
    ? "closed without merge"
    : !verifying
      ? null
      : summary.verifiedAll
        ? "Verified by GitHub"
        : "unverified";
  return {
    text: `${summary.merged}/${summary.total} merged${mark === null ? "" : ` · ${mark}`}`,
    tone: summary.closedUnmerged
      ? ("warning" as const)
      : verifying && summary.verifiedAll && summary.merged === summary.total
        ? ("success" as const)
        : ("neutral" as const),
  };
}
