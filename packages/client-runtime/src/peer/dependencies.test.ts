import { describe, expect, it } from "vite-plus/test";
import type { PeerTask, PeerDependencySnapshot } from "@t3tools/contracts";
import {
  dependencyIndex,
  dependenciesOf,
  neededBy,
  blockers,
  candidates,
  blockedLabel,
  cycleSentence,
} from "./dependencies.ts";
const task = (id: string, status: PeerTask["status"] = "open"): PeerTask => ({
  id,
  key: id.toUpperCase(),
  title: id,
  status,
  createdAt: "",
  updatedAt: "",
  createdBy: "ana",
});
const snapshot: PeerDependencySnapshot = {
  workspace: "acme",
  available: true,
  projects: { app: { b: ["a", "gone"], c: ["b"] } },
};
describe("dependencies shared selectors", () => {
  it("ignores removed targets, shows both directions, candidates and cycle labels", () => {
    const index = dependencyIndex([task("a"), task("b"), task("c", "done")], []);
    expect(dependenciesOf(snapshot, "app", "b", index).map((v) => v.task.id)).toEqual(["a"]);
    expect(neededBy(snapshot, "app", "b", index).map((v) => v.task.id)).toEqual(["c"]);
    expect(blockedLabel(blockers(snapshot, "app", "b", index))).toBe("Blocked by A");
    expect(blockers(snapshot, "app", "c", index)).toEqual([]);
    expect(candidates(snapshot, "app", "b", index).map((v) => [v.task.id, v.checked])).toEqual([
      ["a", true],
    ]);
    expect(cycleSentence(["a", "b", "a"], index)).toBe("A cycle cannot be recorded: A → B → A.");
    expect(candidates({ ...snapshot, available: false }, "app", "b", index)).toEqual([]);
  });
  it("counts blockers and clears a mark when each dependency closes or merges", () => {
    const next = { ...snapshot, projects: { app: { b: ["a", "d"] } } };
    const index = dependencyIndex([task("a"), task("b"), task("d", "review")], []);
    expect(blockedLabel(blockers(next, "app", "b", index))).toBe("Blocked by A +1");
    expect(
      blockers(
        next,
        "app",
        "b",
        dependencyIndex([task("a", "done"), task("d", "done"), task("b")], []),
      ),
    ).toEqual([]);
  });
});
