import { describe, expect, it } from "vite-plus/test";
import type { PeerWorkThread } from "@t3tools/contracts";
import {
  deliveryBadge,
  pullRequestRows,
  taskDelivery,
  verificationReadKey,
  verificationWaiting,
} from "./github.ts";
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

describe("a task's delivery badge", () => {
  const badge = (prs: PeerWorkThread["pullRequests"], verifying: boolean) =>
    deliveryBadge(taskDelivery([thread(prs)], "task"), verifying);
  const second = { ...pr, url: pr.url.replace("12", "13") };
  it("says the same in its words and in its accessible label for every state", () => {
    expect(badge([{ ...pr, github }], true)).toEqual({
      text: "1/1 merged · Verified by GitHub",
      tone: "success",
    });
    expect(badge([{ ...pr, github }, second], true)).toEqual({
      text: "1/2 merged · unverified",
      tone: "neutral",
    });
    expect(badge([pr, second], false)).toEqual({ text: "0/2 merged", tone: "neutral" });
  });
  it("warns about a pull request closed without merge, even one GitHub verified", () => {
    // Verified, so the mark would have said "Verified by GitHub" over a warning about the same task.
    expect(badge([{ ...pr, github: { ...github, state: "closed" } }], true)).toEqual({
      text: "0/1 merged · closed without merge",
      tone: "warning",
    });
    expect(badge([{ ...pr, state: "closed" }], false).text).toBe(
      "0/1 merged · closed without merge",
    );
  });
});

describe("the verification section's refresh", () => {
  const verification = (workspace: string, configured: boolean, lastVerifiedAt: string | null) => ({
    workspace,
    configured,
    lastVerifiedAt,
  });
  const key = (
    entries: ReadonlyArray<ReturnType<typeof verification>>,
    workspace: { revision?: string; threads?: PeerWorkThread[] } = {},
  ) =>
    verificationReadKey(
      { github: { cli: false, account: null, signIn: null, error: null, verification: entries } },
      {
        slug: "acme",
        ...(workspace.revision === undefined ? {} : { revision: workspace.revision }),
        projects: [{ work: { threads: workspace.threads ?? [] } }],
      },
    );
  it("reads again when the github block is applied or removed", () => {
    const off = key([verification("acme", false, null)], { revision: "r1" });
    // The Hub's applied configuration moves before the app's cached verification catches up…
    expect(key([verification("acme", false, null)], { revision: "r2" })).not.toBe(off);
    // …and the cached verification flipping is enough on its own (a Hub that sends no revision).
    expect(key([verification("acme", true, null)], { revision: "r1" })).not.toBe(off);
    expect(key([])).not.toBe(key([verification("acme", true, null)]));
  });
  it("reads again when a delivery is verified, and only for this workspace", () => {
    const waiting = key([verification("acme", true, null)]);
    expect(key([verification("acme", true, "2026-10-10T12:00:00Z")])).not.toBe(waiting);
    const delivered = (verifiedAt: string) => [
      thread([{ ...pr, github: { ...github, verifiedAt } }]),
    ];
    expect(
      key([verification("acme", true, null)], { threads: delivered("2026-10-10T12:00:01Z") }),
    ).not.toBe(waiting);
    expect(
      key([verification("acme", true, null)], { threads: delivered("2026-10-10T12:00:01Z") }),
    ).not.toBe(
      key([verification("acme", true, null)], { threads: delivered("2026-10-10T12:00:09Z") }),
    );
    // Another workspace's verification, and work that only the owner's Peer reported, change nothing.
    expect(key([verification("acme", true, null), verification("other", true, "2026-10-10")])).toBe(
      waiting,
    );
    expect(key([verification("acme", true, null)], { threads: [thread([pr])] })).toBe(waiting);
  });
  it("waits on GitHub until a delivery is verified, and not on a Hub that cannot verify", () => {
    const status = { configured: true, lastVerifiedAt: null };
    expect(verificationWaiting(status)).toBe(true);
    expect(verificationWaiting({ ...status, lastVerifiedAt: "2026-10-10T12:00:00Z" })).toBe(false);
    expect(verificationWaiting({ configured: false, lastVerifiedAt: null })).toBe(false);
    expect(verificationWaiting({ ...status, unsupported: true })).toBe(false);
  });
});
