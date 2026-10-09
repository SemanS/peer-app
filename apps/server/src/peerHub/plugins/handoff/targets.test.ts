import { describe, expect, it } from "vite-plus/test";
import { pullRequest, targetsOf } from "./targets.ts";
import type { PeerWorkThread } from "@t3tools/contracts";
describe("only author owned GitHub pull requests", () => {
  it("refuses URL lookalikes and cross repository targets", () => {
    for (const url of [
      "https://github.com.evil.test/o/r/pull/1",
      "http://github.com/o/r/pull/1",
      "https://github.com/o/r/pull/0",
      "https://github.com/o/r/pull/1/evil",
      "https://github.com/o/r/pull/1;rm",
    ])
      expect(pullRequest(url)).toBeNull();
    expect(
      pullRequest("https://github.com/o/r/pull/1", "https://github.com/o/other.git"),
    ).toBeNull();
    expect(pullRequest("https://github.com/o/r/pull/1", "git@github.com:o/r.git")).not.toBeNull();
  });
  it("deduplicates only own open PRs", () => {
    const thread: PeerWorkThread = {
      id: "a",
      task: "t",
      email: "ana",
      environment: "laptop",
      status: "idle",
      title: "t",
      source: "peer",
      seenAt: "",
      repository: "https://github.com/o/r.git",
      pullRequests: [{ url: "https://github.com/o/r/pull/1", state: "open", headBranch: "branch" }],
    };
    expect(
      targetsOf(
        [
          thread,
          thread,
          {
            ...thread,
            email: "ben",
            pullRequests: [
              { url: "https://github.com/o/r/pull/2", state: "open", headBranch: "b" },
            ],
          },
        ],
        "t",
        "ana",
      ).targets,
    ).toHaveLength(1);
    expect(
      targetsOf([{ ...thread, repository: "https://bitbucket.org/o/r" }], "t", "ana").foreign,
    ).toBe(true);
  });
});
