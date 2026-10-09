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
    open: undefined,
    state: "not checked",
  });
  expect(cachedImpactHealth("Bob", "/lab/bob", { impact })).toEqual({
    computer: "Bob",
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
  ).toEqual({ computer: "Bob", open: 3, state: "not checked" });
});
