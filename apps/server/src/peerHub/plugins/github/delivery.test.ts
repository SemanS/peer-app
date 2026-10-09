import { describe, expect, it } from "vite-plus/test";
import type { PeerWorkThread } from "@t3tools/contracts";
import { deliveryNotices, deliveryText, type DeliveryMemory } from "./delivery.ts";
const base: PeerWorkThread = {
  id: "t",
  task: "task",
  title: "",
  email: "ana",
  status: "idle",
  source: "peer",
  environment: "a",
  seenAt: "2026-10-09",
};
const thread = (state: "open" | "merged" | "closed", verified = true) => [
  {
    ...base,
    pullRequests: [
      {
        url: "https://github.com/acme/app/pull/123",
        state: "open" as const,
        headBranch: "feature/test",
        ...(verified
          ? {
              github: {
                state,
                headBranch: "feature/test",
                baseBranch: "peer",
                updatedAt: "2026-10-09T12:02:11Z",
                verifiedAt: "2026-10-09T12:02:12Z",
                mergedAt: "2026-10-09T12:02:10Z",
                mergeCommit: "4f3c2a1000",
              },
            }
          : {}),
      },
    ],
  },
];
describe("verified delivery notices", () => {
  it("baselines, says transitions once, and rebaselines when re-enabled", () => {
    const memory: DeliveryMemory = { baseline: false, epoch: 0, told: new Map() };
    expect(deliveryNotices(memory, thread("open"), "task", "KRK-812", 0)).toBeNull();
    expect(deliveryNotices(memory, thread("merged"), "task", "KRK-812", 0)).toBe(
      "Peer: GitHub confirms PR #123 (feature/test) merged into peer at 12:02 UTC, merge 4f3c2a1. KRK-812: 1 of 1 linked PRs merged.",
    );
    expect(deliveryNotices(memory, thread("merged"), "task", "KRK-812", 0)).toBeNull();
    expect(deliveryNotices(memory, thread("merged"), "task", "KRK-812", 1)).toBeNull();
    expect(deliveryNotices(memory, thread("closed"), "task", "KRK-812", 1)).toContain(
      "closed without merge",
    );
    expect(deliveryNotices(memory, thread("open"), "task", "KRK-812", 1)).toBe(
      "Peer: GitHub reports PR #123 open again.",
    );
  });
  it("never tells reported changes and describes missing evidence without claiming verification", () => {
    const memory: DeliveryMemory = { baseline: false, epoch: 0, told: new Map() };
    deliveryNotices(memory, thread("open", false), "task", "KRK-812", 0);
    expect(deliveryNotices(memory, thread("merged", false), "task", "KRK-812", 0)).toBeNull();
    expect(deliveryText([], "task", "KRK-812", false, new Map())).toBe(
      "No pull request is linked to KRK-812 yet.\nStates are as reported, not verified by GitHub.",
    );
  });
  it("caps each step at three lines, preserves the next transition, and clips branches", () => {
    const memory: DeliveryMemory = { baseline: false, epoch: 0, told: new Map() };
    const many = (state: "open" | "merged") => {
      const source = thread(state)[0]!;
      const pr = source.pullRequests[0]!;
      return [
        {
          ...source,
          pullRequests: [1, 2, 3, 4].map((n) => ({
            ...pr,
            url: `https://github.com/acme/app/pull/${n}`,
            github: { ...pr.github!, headBranch: `feature/${"a".repeat(150)}` },
          })),
        },
      ];
    };
    deliveryNotices(memory, many("open"), "task", "KRK-812", 0);
    const first = deliveryNotices(memory, many("merged"), "task", "KRK-812", 0)!;
    expect(first.split("\n")).toHaveLength(3);
    expect(first).not.toContain("a".repeat(101));
    expect(deliveryNotices(memory, many("merged"), "task", "KRK-812", 0)).toContain("PR #4");
    expect(deliveryNotices(memory, many("merged"), "task", "KRK-812", 0)).toBeNull();
  });
});
