/**
 * Pull-request evidence from GitHub, read with GitHub CLI: open pull requests of a work's branch,
 * and the state of those already registered. Lookups never delay a work report; they run beside it
 * and the next report carries what they found.
 *
 * @module peerHub/plugins/github/pullRequests
 */
import type { PeerWorkPullRequest } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { gitHubRepository } from "../../workLifecycle.ts";

const HostPullRequest = Schema.Struct({
  url: Schema.String,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  headRefName: Schema.String,
  isCrossRepository: Schema.Boolean,
});
const decode = Schema.decodeUnknownOption(HostPullRequest);
const FIELDS = "url,state,headRefName,isCrossRepository";

/**
 * Discover only open PRs: a historical merge on a reused branch proves nothing about this work.
 * Once registered, refresh each exact URL, including while the runtime is absent. A partial or
 * failed read returns undefined so the hub keeps its last evidence and never infers completion.
 */
export async function readWorkPullRequests(
  input: {
    readonly repositoryUrl: string;
    readonly branch: string;
    readonly known: ReadonlyArray<PeerWorkPullRequest>;
  },
  run: (args: ReadonlyArray<string>) => Promise<string>,
): Promise<ReadonlyArray<PeerWorkPullRequest> | undefined> {
  const repo = gitHubRepository(input.repositoryUrl);
  if (repo === null || input.branch === "" || input.known.length > 20) return undefined;
  const prefix = `https://github.com/${repo.nameWithOwner.toLowerCase()}/pull/`;
  const belongs = (url: string) => {
    const lower = url.toLowerCase();
    return lower.startsWith(prefix) && /^[1-9][0-9]*$/.test(lower.slice(prefix.length));
  };
  if (input.known.some((pr) => !belongs(pr.url))) return undefined;
  try {
    let rows: unknown;
    if (input.known.length === 0) {
      rows = JSON.parse(
        await run([
          "pr",
          "list",
          "--repo",
          repo.nameWithOwner,
          "--head",
          input.branch,
          "--state",
          "open",
          "--limit",
          "21",
          "--json",
          FIELDS,
        ]),
      );
    } else {
      const snapshots: unknown[] = [];
      for (const pr of input.known)
        snapshots.push(JSON.parse(await run(["pr", "view", pr.url, "--json", FIELDS])));
      rows = snapshots;
    }
    if (!Array.isArray(rows) || rows.length > 20) return undefined;
    const result: PeerWorkPullRequest[] = [];
    for (const [index, row] of rows.entries()) {
      const decoded = decode(row);
      if (Option.isNone(decoded)) return undefined;
      const pr = decoded.value;
      const known = input.known[index];
      if (
        !belongs(pr.url) ||
        pr.isCrossRepository ||
        (known === undefined
          ? pr.state !== "OPEN" || pr.headRefName !== input.branch
          : pr.url.toLowerCase() !== known.url.toLowerCase() ||
            (known.state !== "unknown" && pr.headRefName !== known.headBranch))
      )
        return undefined;
      result.push({
        url: pr.url,
        state: pr.state.toLowerCase() as PeerWorkPullRequest["state"],
        headBranch: pr.headRefName,
      });
    }
    return result;
  } catch {
    return undefined;
  }
}

/** Host reads never delay heartbeats. At most four run together, once a minute per work. */
export class WorkDeliveryTracker {
  private readonly cache = new Map<
    string,
    { at: number; value: ReadonlyArray<PeerWorkPullRequest> | undefined }
  >();
  private readonly pending = new Set<string>();
  private readonly waiting = new Map<string, () => Promise<void>>();

  private drain(): void {
    while (this.pending.size < 4 && this.waiting.size > 0) {
      const [key, job] = this.waiting.entries().next().value!;
      this.waiting.delete(key);
      this.pending.add(key);
      void job().finally(() => {
        this.pending.delete(key);
        this.drain();
      });
    }
  }

  read(
    input: Parameters<typeof readWorkPullRequests>[0] & { readonly workId: string },
    run: Parameters<typeof readWorkPullRequests>[1],
    now: number,
  ): ReadonlyArray<PeerWorkPullRequest> | undefined {
    const key = JSON.stringify([
      input.workId,
      input.repositoryUrl,
      input.branch,
      input.known.map((pr) => pr.url).sort(),
    ]);
    const cached = this.cache.get(key);
    if (
      (cached === undefined || now - cached.at >= 60_000) &&
      !this.pending.has(key) &&
      !this.waiting.has(key) &&
      this.waiting.size < 500
    ) {
      this.waiting.set(key, async () => {
        const value = await readWorkPullRequests(input, run);
        this.cache.set(key, { at: now, value });
        if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
      });
      this.drain();
    }
    return cached?.value;
  }
}
