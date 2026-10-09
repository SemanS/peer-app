import { describe, expect, it } from "vite-plus/test";
import type { PeerWorkThread } from "@t3tools/contracts";
import { pullRequestRows, taskDelivery } from "./github.ts";
const github = {
  state: "merged" as const,
  headBranch: "feature/test",
  baseBranch: "peer",
  updatedAt: "2026-10-09",
  verifiedAt: "2026-10-09",
};
const thread = (
  prs: PeerWorkThread["pullRequests"],
  repository = "https://github.com/acme/app.git",
): PeerWorkThread => ({
  id: "thread",
  task: "task",
  title: "Work",
  email: "ana@acme.test",
  status: "idle",
  source: "peer",
  environment: "a",
  seenAt: "2026-10-09",
  repository,
  pullRequests: prs,
});
const pr = {
  url: "https://github.com/acme/app/pull/12",
  state: "open" as const,
  headBranch: "feature/test",
};
describe("task delivery evidence", () => {
  it("deduplicates links and counts two verified merges", () => {
    const threads = [
      thread([
        { ...pr, github },
        { ...pr, url: pr.url.replace("12", "13"), github },
      ]),
      thread([{ ...pr, github }]),
    ];
    expect(taskDelivery(threads, "task")).toMatchObject({ total: 2, merged: 2, verifiedAll: true });
  });
  it("distinguishes mixed, closed and conflicting reported states", () => {
    expect(
      taskDelivery(
        [
          thread([
            { ...pr, github },
            { ...pr, url: pr.url.replace("12", "13") },
          ]),
        ],
        "task",
      ),
    ).toMatchObject({ total: 2, merged: 1, verifiedAll: false, reportedOnly: false });
    expect(
      taskDelivery([thread([{ ...pr, github: { ...github, state: "closed" } }])], "task")
        .closedUnmerged,
    ).toBe(true);
    const rows = pullRequestRows(
      [thread([{ ...pr, state: "merged", github: { ...github, state: "open" } }])],
      "task",
    );
    expect(rows[0]).toMatchObject({
      state: "open",
      reportedState: "merged",
      disagreement: true,
      source: "GitHub",
    });
  });
  it("keeps reported-only badges plain and describes hosts outside github.com", () => {
    expect(taskDelivery([thread([pr])], "task").reportedOnly).toBe(true);
    expect(
      pullRequestRows([thread([pr])], "task", new Map([["ana@acme.test", "Ana"]]))[0]?.source,
    ).toBe("reported by Ana's Peer");
    expect(taskDelivery([thread([], "git@bitbucket.org:acme/app.git")], "task").hosts).toEqual([
      "bitbucket.org",
    ]);
  });
});
