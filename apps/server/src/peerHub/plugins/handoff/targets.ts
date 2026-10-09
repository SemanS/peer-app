import type { PeerWorkThread } from "@t3tools/contracts";
import { gitHubRepository } from "../../workLifecycle.ts";
export function pullRequest(url: string, repository?: string) {
  const m =
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/.exec(url);
  if (!m) return null;
  const repo = `${m[1]}/${m[2]}`;
  if (
    repository &&
    gitHubRepository(repository)?.nameWithOwner.toLowerCase() !== repo.toLowerCase()
  )
    return null;
  return { repository: repo, number: m[3]! };
}
export function targetsOf(
  threads: ReadonlyArray<PeerWorkThread>,
  task: string,
  email: string,
  allStates = false,
) {
  const targets = new Map<string, string>();
  let foreign = false;
  for (const t of threads.filter((t) => t.task === task && t.email === email)) {
    if (!t.repository || !gitHubRepository(t.repository)) {
      foreign = true;
      continue;
    }
    for (const pr of t.pullRequests ?? []) {
      if (!allStates && pr.state !== "open") continue;
      if (pullRequest(pr.url, t.repository)) targets.set(pr.url, t.repository);
    }
  }
  return { targets: [...targets].map(([url, repository]) => ({ url, repository })), foreign };
}
