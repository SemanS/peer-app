import { assert, describe, expect, it } from "@effect/vitest";

import {
  boundedWorkReport,
  gitHubRepository,
  mergePullRequestEvidence,
  nativeRuntimePresent,
  nativeWorkPullRequests,
  pullRequestBatch,
  restoreWorkIdentity,
  runtimeStillPresent,
} from "./workLifecycle.ts";
import type { ThreadPullRequestLink } from "@t3tools/contracts";

const input = {
  repositoryUrl: "git@github.com:acme/service.git",
  branch: "fix/lifecycle",
  known: [],
};

describe("work delivery evidence", () => {
  it("registers a full native stack while batching only host reads", () => {
    const links = Array.from({ length: 21 }, (_, index) => ({
      host: "github.com",
      repository: "acme/service",
      number: index + 1,
      source: "manual",
      snapshot: { headBranch: input.branch, state: "open" },
    })) as unknown as ThreadPullRequestLink[];
    const required = nativeWorkPullRequests(input.repositoryUrl, input.branch, links)!;
    expect(required).toHaveLength(21);
    const observed = pullRequestBatch(required, input.branch).map((pr) => ({
      ...pr,
      state: "merged" as const,
    }));
    const merged = mergePullRequestEvidence(required, observed)!;
    expect(merged).toHaveLength(21);
    expect(merged.filter((pr) => pr.state === "open")).toHaveLength(1);
    expect(pullRequestBatch(merged, input.branch).some((pr) => pr.state === "open")).toBe(true);
    expect(
      nativeWorkPullRequests("https://github.com/elsewhere/repo", input.branch, links),
    ).toBeUndefined();
  });
});

describe("runtime presence", () => {
  it("keeps a confirmed idle runtime without pretending it recently did work", () => {
    expect(runtimeStillPresent({ lastActivity: 0, runtime: "idle", now: 60 * 60_000 })).toBe(true);
    expect(runtimeStillPresent({ lastActivity: 0, runtime: "working", now: 60 * 60_000 })).toBe(
      true,
    );
    expect(runtimeStillPresent({ lastActivity: 0, runtime: undefined, now: 60 * 60_000 })).toBe(
      false,
    );
    expect(runtimeStillPresent({ lastActivity: 0, runtime: undefined, now: 60_000 })).toBe(true);
  });

  it("expires confirmed absent runtimes from their last presence, not their last tool call", () => {
    expect(
      runtimeStillPresent({
        lastActivity: 0,
        lastPresent: 3_600_000,
        runtime: null,
        now: 3_700_000,
      }),
    ).toBe(true);
    expect(
      runtimeStillPresent({
        lastActivity: 0,
        lastPresent: 3_600_000,
        runtime: null,
        now: 3_800_000,
      }),
    ).toBe(false);
    expect(
      nativeRuntimePresent({ status: "idle", providerSessionId: "p1" }, [
        { id: "p1", status: "stopped" },
      ]),
    ).toBe(false);
    expect(
      nativeRuntimePresent({ status: "idle", providerSessionId: "p1" }, [
        { id: "p1", status: "ready" },
      ]),
    ).toBe(true);
    expect(
      nativeRuntimePresent({ status: "active", providerSessionId: "p1" }, [
        { id: "old", status: "running" },
      ]),
    ).toBe(false);
  });

  it("restores a temporary alias and a missing branch before replaying dormant records", () => {
    const report = {
      id: "herdr:terminal",
      project: "app",
      title: "Build",
      source: "herdr" as const,
      status: "idle" as const,
    };
    const previous = {
      ...report,
      id: "herdr:codex:session",
      previousId: report.id,
      branch: input.branch,
      repository: "api",
      email: "ana@acme.test",
      environment: "laptop",
      seenAt: "2026-10-06T00:00:00Z",
    };
    expect(restoreWorkIdentity(report, [previous])).toMatchObject({
      id: previous.id,
      branch: input.branch,
      repository: "api",
      previousId: report.id,
    });
    expect(restoreWorkIdentity({ ...report, repository: "other" }, [previous]).id).toBe(report.id);
  });

  it("keeps live reports and rotates every dormant work within the 500-row limit", () => {
    const thread = {
      id: "herdr:live",
      project: "app",
      title: "Build",
      source: "herdr" as const,
      status: "idle" as const,
    };
    const reports = [
      thread,
      ...Array.from({ length: 1000 }, (_, i) => ({
        ...thread,
        id: `retained:${i}`,
        runtimePresent: false,
      })),
    ];
    const seen = new Set<string>();
    for (let round = 0; round < 3; round++) {
      const batch = boundedWorkReport(reports, round);
      expect(batch).toHaveLength(500);
      expect(batch[0]?.id).toBe(thread.id);
      batch.forEach((row) => seen.add(row.id));
    }
    expect(seen.size).toBe(1001);
  });
});

describe("gitHubRepository", () => {
  it("reads owner/repo from every way people write a GitHub repository", () => {
    for (const address of [
      "SemanS/vocabulift",
      "https://github.com/SemanS/vocabulift",
      "https://github.com/SemanS/vocabulift.git",
      "https://github.com/SemanS/vocabulift/tree/main/src",
      "git@github.com:SemanS/vocabulift.git",
      "ssh://git@github.com/SemanS/vocabulift.git",
    ]) {
      assert.deepStrictEqual(
        gitHubRepository(address),
        {
          nameWithOwner: "SemanS/vocabulift",
          name: "vocabulift",
          httpsUrl: "https://github.com/SemanS/vocabulift.git",
        },
        address,
      );
    }
  });

  it("leaves other hosts and local paths to git", () => {
    for (const address of [
      "https://gitlab.com/acme/app.git",
      "git@bitbucket.org:acme/app.git",
      "/Users/ana/code/app",
      "file:///srv/git/app.git",
      "https://github.com/SemanS",
    ]) {
      assert.isNull(gitHubRepository(address), address);
    }
  });
});
