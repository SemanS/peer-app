import { describe, expect, it } from "vite-plus/test";
import { LEGACY_MS, Snapshots } from "./snapshot.ts";
describe("dependency snapshot retention", () => {
  it("does not republish unchanged values, keeps per-workspace probes and cleans membership", () => {
    const cache = new Snapshots();
    expect(cache.put({ workspace: "a", available: false, projects: {} }, 1)).toBe(true);
    expect(cache.due("a", LEGACY_MS)).toBe(false);
    expect(cache.due("a", LEGACY_MS + 1)).toBe(true);
    expect(cache.put({ workspace: "a", available: false, projects: {} }, 2)).toBe(false);
    expect(cache.hasEdges("a")).toBe(false);
    expect(cache.apply("a", "app", "b", ["a"], 3)).toBe(true);
    expect(cache.hasEdges("a")).toBe(true);
    expect(cache.apply("a", "app", "b", ["a"], 4)).toBe(false);
    cache.apply("a", "app", "b", [], 5);
    expect(cache.values.get("a")?.projects).toEqual({});
    cache.put({ workspace: "b", available: true, projects: {} }, 5);
    cache.clean(["b"]);
    expect([...cache.values.keys()]).toEqual(["b"]);
    cache.forget("b");
    expect(cache.values.size).toBe(0);
  });
});
