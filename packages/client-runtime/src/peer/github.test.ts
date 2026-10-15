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
  it("suggests redelivery only for a merge the owner's Peer reports and GitHub's record lacks", () => {
    const note = (
      reported: "open" | "closed" | "merged" | "unknown",
      verified: "open" | "closed" | "merged",
    ) =>
      pullRequestRows(
        [thread([{ ...pr, state: reported, github: { ...github, state: verified } }])],
        "task",
      )[0]?.note;
    // GitHub missed the merge: the record is open (the spec's scenario) or closed, the report merged.
    expect(note("merged", "open")).toContain("Redeliver the merge event");
    expect(note("merged", "closed")).toContain("Redeliver the merge event");
    // GitHub is ahead of the report, or the two differ in some other way: nothing was missed.
    for (const [reported, verified] of [
      ["open", "merged"],
      ["open", "closed"],
      ["closed", "merged"],
      ["closed", "open"],
    ] as const) {
      expect(note(reported, verified)).toBe(
        `The owner's Peer reports ${reported}. GitHub's state counts.`,
      );
    }
    // Agreement, and a report that could not read the state, say nothing.
    expect(note("merged", "merged")).toBeNull();
    expect(note("unknown", "merged")).toBeNull();
    expect(
      pullRequestRows(
        [thread([{ ...pr, state: "unknown", github: { ...github, state: "open" } }])],
        "task",
      )[0],
    ).toMatchObject({ disagreement: false, note: null });
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
