import type { PeerWorkThread } from "./base.ts";

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
      verified: boolean;
    }
  >();
  for (const thread of threads.filter((t) => t.task === taskId))
    for (const pr of thread.pullRequests ?? []) {
      const id = pr.url.toLowerCase();
      if (rows.has(id) && (!pr.github || rows.get(id)?.verified)) continue;
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
        disagreement: pr.github !== undefined && pr.github.state !== pr.state,
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
