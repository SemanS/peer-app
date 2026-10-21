/** Runtime leases and host evidence for durable work. No model calls or agent transcripts. */
import type {
  PeerWorkPullRequest,
  PeerWorkStatus,
  PeerWorkThread,
  ThreadPullRequestLink,
} from "@t3tools/contracts";

import type { ReportedThread } from "./core/hub/hubApi.ts";

export interface ResumableNativeThread {
  readonly thread: string;
  readonly agent: string;
  readonly nativeId: string;
  readonly cwd: string;
}

/** A repository on github.com. */
export interface GitHubRepository {
  /** `owner/repo` */
  readonly nameWithOwner: string;
  readonly name: string;
  /** What Peer clones: https, so GitHub CLI's sign-in applies. */
  readonly httpsUrl: string;
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/**
 * The github.com repository an address names: https, ssh and scp-style
 * addresses, a page of it pasted from the browser, or `owner/repo`.
 */
export function gitHubRepository(address: string): GitHubRepository | null {
  const text = address.trim();
  let path: string | null = null;
  const scp = /^(?:[^@/\s]+@)?github\.com:([^\s]+)$/i.exec(text);
  if (scp !== null) {
    path = scp[1] ?? null;
  } else if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
    path = text;
  } else {
    try {
      const url = new URL(text);
      const github = url.hostname.toLowerCase() === "github.com";
      if (github && ["https:", "http:", "ssh:", "git:"].includes(url.protocol)) path = url.pathname;
    } catch {
      return null;
    }
  }
  if (path === null) return null;
  const [owner, repo] = path.replace(/^\/+/, "").split("/");
  const name = repo?.replace(/\.git$/i, "");
  if (!owner || !name || !SEGMENT.test(owner) || !SEGMENT.test(name)) return null;
  return {
    nameWithOwner: `${owner}/${name}`,
    name,
    httpsUrl: `https://github.com/${owner}/${name}.git`,
  };
}

/** Recover known identity before replaying dormant work, including a temporary herdr alias. */
export function restoreWorkIdentity(
  thread: ReportedThread,
  previous: ReadonlyArray<PeerWorkThread>,
): ReportedThread {
  const known = previous.find(
    (old) =>
      (old.id === thread.id || old.previousId === thread.id) &&
      (thread.repository === undefined ||
        old.repository === undefined ||
        old.repository === thread.repository) &&
      (thread.branch === undefined || old.branch === undefined || old.branch === thread.branch),
  );
  if (known === undefined) return thread;
  const branch = thread.branch ?? known.branch;
  const repository = thread.repository ?? known.repository;
  const previousId = thread.previousId ?? known.previousId;
  return {
    ...thread,
    id: known.id,
    ...(branch === undefined ? {} : { branch }),
    ...(repository === undefined ? {} : { repository }),
    ...(previousId === undefined ? {} : { previousId }),
  };
}

/** Live runtimes get every heartbeat; rotate dormant evidence within the wire's 500-row bound. */
export function boundedWorkReport(
  threads: ReadonlyArray<ReportedThread>,
  round: number,
): ReadonlyArray<ReportedThread> {
  const live = threads.filter((thread) => thread.runtimePresent !== false);
  const dormant = threads.filter((thread) => thread.runtimePresent === false);
  const room = Math.max(0, 500 - live.length);
  const start = dormant.length === 0 ? 0 : (round * Math.max(1, room)) % dormant.length;
  return [...live.slice(0, 500), ...dormant.slice(start), ...dormant.slice(0, start)].slice(0, 500);
}

/** Register the full required set; only host reads are batched, with unfinished PRs first. */
export function pullRequestBatch(
  prs: ReadonlyArray<PeerWorkPullRequest>,
  branch: string | undefined,
): ReadonlyArray<PeerWorkPullRequest> {
  const anchor = prs.find((pr) => pr.headBranch === branch);
  return [
    ...(anchor === undefined ? [] : [anchor]),
    ...prs.filter((pr) => pr !== anchor && pr.state !== "merged"),
  ].slice(0, 20);
}

export function mergePullRequestEvidence(
  required: ReadonlyArray<PeerWorkPullRequest> | undefined,
  observed: ReadonlyArray<PeerWorkPullRequest> | undefined,
): ReadonlyArray<PeerWorkPullRequest> | undefined {
  if (observed === undefined) return required;
  const merged = new Map((required ?? []).map((pr) => [pr.url.toLowerCase(), pr]));
  for (const pr of observed) merged.set(pr.url.toLowerCase(), pr);
  return [...merged.values()];
}

/** A durable provider thread can outlive its actual runtime, including after app recovery. */
export function nativeRuntimePresent(
  provider: { readonly status: string; readonly providerSessionId: string | null } | undefined,
  sessions: ReadonlyArray<{ readonly id: string; readonly status: string }>,
): boolean {
  return (
    provider !== undefined &&
    (provider.status === "idle" || provider.status === "active") &&
    sessions.some(
      (session) =>
        session.id === provider.providerSessionId &&
        ["starting", "ready", "running", "waiting"].includes(session.status),
    )
  );
}

/** Unrelated native PR links must not poison an environment's entire heartbeat report. */
export function nativeWorkPullRequests(
  repositoryUrl: string,
  branch: string | null,
  links: ReadonlyArray<ThreadPullRequestLink>,
): ReadonlyArray<PeerWorkPullRequest> | undefined {
  const repo = gitHubRepository(repositoryUrl);
  const visible = links.filter((link) => link.source !== "stack-dismissed");
  if (repo === null || branch === null || visible.length === 0) return undefined;
  if (
    visible.some(
      (link) =>
        link.host !== "github.com" ||
        link.repository.toLowerCase() !== repo.nameWithOwner.toLowerCase(),
    )
  )
    return undefined;
  if (!visible.some((link) => link.snapshot?.headBranch === branch)) return undefined;
  return visible.map((link) => ({
    url: `https://github.com/${repo.nameWithOwner}/pull/${link.number}`,
    state: link.snapshot?.state ?? "unknown",
    headBranch: link.snapshot?.headBranch ?? branch,
  }));
}

/** Hooks are a fallback lease. herdr's confirmed runtime survives quiet thinking or user waits. */
export function runtimeStillPresent(input: {
  readonly runtime: PeerWorkStatus | null | undefined;
  readonly lastActivity: number;
  readonly lastPresent?: number;
  readonly now: number;
}): boolean {
  if (input.runtime === null)
    return input.now - Math.max(input.lastPresent ?? 0, input.lastActivity) <= 180_000;
  return input.runtime !== undefined || input.now - input.lastActivity <= 30 * 60_000;
}
