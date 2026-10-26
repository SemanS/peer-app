import { expect, it } from "@effect/vitest";
import type { PeerBriefLink, PeerTask, PeerTaskBrief } from "@t3tools/contracts";

import { planItems, planLine } from "./plan.ts";

const task = (id: string, status: PeerTask["status"] = "open"): PeerTask => ({
  id,
  title: `Task ${id}`,
  status,
  createdBy: "ana@team.test",
  createdAt: "now",
  updatedAt: "now",
});
const brief = (change: string, revision = 3): PeerTaskBrief => ({
  project: "app",
  task: "t",
  goal: "Goal",
  checklist: [],
  source: { kind: "openspec", repository: "app", change, fingerprint: "a" },
  savedBy: "ana@team.test",
  savedAt: "now",
  revision,
});
const link = (
  state: PeerBriefLink["state"],
  extra: Partial<PeerBriefLink> = {},
): PeerBriefLink => ({
  state,
  served: true,
  brief: null,
  ...extra,
});

it("plans one item per drift and a task for each change nobody works on", () => {
  const items = planItems(
    [
      { task: task("a"), link: link("proposed", { proposed: { change: "alpha", via: "name" } }) },
      { task: task("b"), link: link("changed", { brief: brief("beta") }) },
      {
        task: task("c"),
        link: link("archived", { brief: brief("gamma"), archivedAs: "2026-10-01-gamma" }),
      },
      { task: task("d", "done"), link: link("archived", { brief: brief("delta") }) },
      { task: task("e"), link: link("missing", { brief: brief("eps") }) },
      {
        task: task("f"),
        link: link("current", { brief: brief("zeta"), mappingDiffers: "zeta-2" }),
      },
      { task: task("g"), link: link("current", { brief: brief("eta") }) },
    ],
    [
      { name: "alpha", title: "Alpha" },
      { name: "beta", title: "Beta" },
      { name: "eta", title: "Eta" },
      { name: "zeta-2", title: "Zeta 2" },
      { name: "theta", title: "Voice recognition between programs" },
    ],
  );
  expect(items.map((item) => [item.id, item.kind, item.task?.id ?? item.change])).toEqual([
    ["b1", "link", "a"],
    ["b2", "refresh", "b"],
    ["b3", "close", "c"],
    ["b4", "unlink", "e"],
    ["b5", "relink", "f"],
    ["b6", "create", "theta"],
  ]);
  expect(items.find((item) => item.kind === "refresh")?.basis).toBe(3);
  expect(items.find((item) => item.kind === "link")?.basis).toBe(0);
  expect(planLine(items[5]!)).toContain('"Voice recognition between programs"');
});

it("plans nothing when every brief matches", () => {
  expect(
    planItems(
      [{ task: task("g"), link: link("current", { brief: brief("eta") }) }],
      [{ name: "eta", title: "Eta" }],
    ),
  ).toEqual([]);
});
