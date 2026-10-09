import { describe, expect, it } from "@effect/vitest";

import { readWorkPullRequests, WorkDeliveryTracker } from "./pullRequests.ts";

const url = "https://github.com/acme/service/pull/7";
const input = {
  repositoryUrl: "git@github.com:acme/service.git",
  branch: "fix/lifecycle",
  known: [],
};
const snapshot = { url, state: "OPEN", headRefName: "fix/lifecycle", isCrossRepository: false };

describe("work delivery evidence", () => {
  it("discovers open pull requests, never a historical merge on a reused branch", async () => {
    let args: readonly string[] = [];
    const found = await readWorkPullRequests(input, async (command) => {
      args = command;
      return JSON.stringify([snapshot]);
    });
    expect(args).toContain("open");
    expect(found).toEqual([{ url, state: "open", headBranch: "fix/lifecycle" }]);
    expect(
      await readWorkPullRequests(input, async () =>
        JSON.stringify([{ ...snapshot, state: "MERGED" }]),
      ),
    ).toBeUndefined();
  });

  it("refreshes the exact registered pull request even after its agent disappears", async () => {
    const found = await readWorkPullRequests(
      { ...input, known: [{ url, state: "open", headBranch: input.branch }] },
      async (args) => {
        expect(args.slice(0, 3)).toEqual(["pr", "view", url]);
        return JSON.stringify({ ...snapshot, state: "MERGED" });
      },
    );
    expect(found?.[0]?.state).toBe("merged");
  });

  it("leaves existing evidence alone on network failure or an incomplete stack", async () => {
    expect(
      await readWorkPullRequests(input, async () => {
        throw new Error("offline");
      }),
    ).toBeUndefined();
    expect(await readWorkPullRequests(input, async () => "not JSON")).toBeUndefined();
    const known = [7, 8].map((n) => ({
      url: url.replace("/7", `/${n}`),
      state: "open" as const,
      headBranch: input.branch,
    }));
    expect(
      await readWorkPullRequests({ ...input, known }, async (args) => {
        if (args.includes(known[1]!.url)) throw new Error("offline");
        return JSON.stringify({ ...snapshot, state: "MERGED" });
      }),
    ).toBeUndefined();
  });

  it("does not accept another repository, a fork's matching branch, or a malformed reply", async () => {
    for (const bad of [
      { ...snapshot, url: "https://github.com/other/service/pull/7" },
      { ...snapshot, headRefName: "fix/other" },
      { ...snapshot, isCrossRepository: true },
      { ...snapshot, state: "wat" },
    ])
      expect(await readWorkPullRequests(input, async () => JSON.stringify([bad]))).toBeUndefined();
  });

  it("learns the head of an unresolved stack link from its exact URL", async () => {
    const known = [{ url, state: "unknown" as const, headBranch: input.branch }];
    expect(
      await readWorkPullRequests({ ...input, known }, async () =>
        JSON.stringify({
          ...snapshot,
          url: url.replace("acme", "Acme"),
          headRefName: "fix/stack-base",
          state: "MERGED",
        }),
      ),
    ).toEqual([
      { url: url.replace("acme", "Acme"), headBranch: "fix/stack-base", state: "merged" },
    ]);
  });

  it("runs every queued work with at most four host reads, even beyond eight works", async () => {
    const tracker = new WorkDeliveryTracker();
    const gate = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const started: string[] = [];
    let active = 0;
    let maximum = 0;
    let completed = 0;
    for (let index = 0; index < 12; index++) {
      const workId = `work:${index}`;
      tracker.read(
        { ...input, workId },
        async () => {
          started.push(workId);
          maximum = Math.max(maximum, ++active);
          await gate.promise;
          active--;
          if (++completed === 12) finished.resolve();
          return "[]";
        },
        0,
      );
    }
    expect(started).toHaveLength(4);
    gate.resolve();
    await finished.promise;
    expect(new Set(started).size).toBe(12);
    expect(maximum).toBe(4);
  });

  it("does not reuse another work's merge evidence on the same branch", async () => {
    const tracker = new WorkDeliveryTracker();
    const finished = Promise.withResolvers<void>();
    const known = [{ url, state: "open" as const, headBranch: input.branch }];
    const lookup = async () => JSON.stringify({ ...snapshot, state: "MERGED" });
    for (let index = 0; index < 4; index++)
      tracker.read({ ...input, known, workId: `${index}` }, lookup, 0);
    tracker.read(
      { ...input, workId: "sentinel" },
      async () => {
        try {
          // This FIFO entry starts after work 0 has completed and populated its cache.
          expect(tracker.read({ ...input, known, workId: "0" }, lookup, 1)?.[0]?.state).toBe(
            "merged",
          );
          expect(tracker.read({ ...input, known, workId: "new-work" }, lookup, 1)).toBeUndefined();
          finished.resolve();
        } catch (error) {
          finished.reject(error);
        }
        return "[]";
      },
      0,
    );
    await finished.promise;
  });
});
