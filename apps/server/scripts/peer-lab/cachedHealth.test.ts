import { expect, it } from "vite-plus/test";
import type { PeerImpactStatus } from "@t3tools/contracts";
import { cachedImpactHealth } from "./cachedHealth.ts";

const impact: PeerImpactStatus = {
  enabled: true,
  forcedOff: false,
  autoIndex: false,
  hubSupport: "supported",
  revision: 1,
  roots: [{ root: "/lab/bob", state: "ready", commands: [] }],
  counts: [],
};
it("keeps an absent Impact slice unknown while an observed empty cache has zero open records", () => {
  expect(cachedImpactHealth("Bob", "/lab/bob", {})).toEqual({
    computer: "Bob",
    eachTaskOpen: undefined,
    open: undefined,
    state: "not checked",
  });
  expect(cachedImpactHealth("Bob", "/lab/bob", { impact })).toEqual({
    computer: "Bob",
    eachTaskOpen: undefined,
    open: 0,
    state: "ready",
  });
});
it("counts only the current lab workspace/project and reads the matching checkout health", () => {
  expect(
    cachedImpactHealth("Bob", "/lab/missing", {
      impact: {
        ...impact,
        counts: [
          { workspace: "acme", project: "lab", task: "ip1", count: 1 },
          { workspace: "acme", project: "lab", task: "ip2", count: 2 },
          { workspace: "elsewhere", project: "lab", task: "ip1", count: 80 },
          { workspace: "acme", project: "other", task: "ip1", count: 40 },
        ],
      },
    }),
  ).toEqual({ computer: "Bob", eachTaskOpen: undefined, open: 3, state: "not checked" });
});
it("expected task counts cannot be satisfied by an unrelated project's old overlap", () => {
  const status = {
    impact: {
      ...impact,
      counts: [
        { workspace: "acme", project: "lab", task: "old-task", count: 2 },
        { workspace: "acme", project: "lab", task: "ip2", count: 1 },
      ],
    },
  };
  expect(cachedImpactHealth("Bob", "/lab/bob", status, ["ip1"]).open).toBe(0);
  expect(cachedImpactHealth("Bob", "/lab/bob", status, ["ip1", "ip2"]).open).toBe(1);
  expect(cachedImpactHealth("Bob", "/lab/bob", status, ["ip1", "ip2"]).eachTaskOpen).toBe(false);
  expect(
    cachedImpactHealth(
      "Bob",
      "/lab/bob",
      {
        impact: {
          ...status.impact,
          counts: [
            ...status.impact.counts,
            { workspace: "acme", project: "lab", task: "ip1", count: 1 },
          ],
        },
      },
      ["ip1", "ip2"],
    ).eachTaskOpen,
  ).toBe(true);
  expect(cachedImpactHealth("Bob", "/lab/bob", {}, ["ip2"]).open).toBeUndefined();
  expect(cachedImpactHealth("Bob", "/lab/bob", {}, ["ip2"]).eachTaskOpen).toBeUndefined();
});
