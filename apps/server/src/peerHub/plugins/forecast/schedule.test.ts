import { describe, expect, it } from "vite-plus/test";
import { newSchedule, observeTips, candidates, recordResult, resultOf } from "./schedule.ts";
const pair = { key: "pair", repository: "repo", a: "a", b: "b", refs: ["a", "b"] as const };
describe("forecast scheduler", () => {
  it("caps rounds at eight, drains a backlog, settles a burst once and prioritizes the newest changed tips", () => {
    const state = newSchedule(),
      rows = Array.from({ length: 20 }, (_, i) => ({
        ...pair,
        key: `p${i.toString().padStart(2, "0")}`,
        a: `${i}`,
        b: `other${i}`,
        refs: [`a${i}`, `b${i}`] as const,
      }));
    const tips = new Map(
      rows.flatMap((p) => [
        [p.refs[0], p.a],
        [p.refs[1], p.b],
      ]),
    );
    observeTips(state, tips, 0);
    const completed: string[] = [];
    for (let round = 0; round < 3; round++)
      for (const row of candidates(state, rows, round)) {
        completed.push(row.key);
        recordResult(state, row, { state: "clean" }, round, 0);
      }
    expect(completed).toHaveLength(20);
    expect(candidates(state, rows, 3)).toEqual([]);
    tips.set("a0", "new0");
    observeTips(state, tips, 100);
    tips.set("a0", "newer0");
    observeTips(state, tips, 101);
    tips.set("a1", "new1");
    observeTips(state, tips, 200);
    const changed = rows.map((p, i) =>
      i === 0 ? { ...p, a: "newer0" } : i === 1 ? { ...p, a: "new1" } : p,
    );
    expect(candidates(state, changed, 5100)).toEqual([]);
    expect(candidates(state, changed, 5200).map((p) => p.key)).toEqual(["p01", "p00"]);
  });
  it("uses unordered commit identities, never retries unrelated histories, and evicts only the least recently used of 512 pairs", () => {
    const state = newSchedule();
    for (let i = 0; i < 512; i++)
      recordResult(state, { ...pair, a: `a${i}`, b: `b${i}` }, { state: "clean" }, i, 0);
    expect(resultOf(state, { a: "b0", b: "a0" })?.result.state).toBe("clean");
    recordResult(state, { ...pair, a: "new", b: "other" }, { state: "unrelated" }, 512, 0);
    expect(state.memo.size).toBe(512);
    expect(resultOf(state, { a: "a1", b: "b1" })).toBeUndefined();
    expect(resultOf(state, { a: "a0", b: "b0" })).toBeDefined();
    expect(candidates(state, [{ ...pair, a: "other", b: "new" }], 1e12, true)).toEqual([]);
  });
  it("settles only changed tips, caches unchanged commits and shares a duty cycle across rounds", () => {
    const state = newSchedule();
    observeTips(
      state,
      new Map([
        ["a", "1"],
        ["b", "2"],
      ]),
      0,
    );
    expect(candidates(state, [pair], 0)).toEqual([pair]);
    recordResult(state, pair, { state: "clean" }, 0, 2000);
    expect(candidates(state, [pair], 2000)).toEqual([]);
    observeTips(
      state,
      new Map([
        ["a", "3"],
        ["b", "2"],
      ]),
      2001,
    );
    expect(candidates(state, [{ ...pair, a: "3", b: "2" }], 6999)).toEqual([]);
    expect(candidates(state, [{ ...pair, a: "3", b: "2" }], 8000)).toHaveLength(1);
  });
  it("backs off failed commit pairs and pauses a repository after three consecutive timeouts", () => {
    const state = newSchedule();
    observeTips(
      state,
      new Map([
        ["a", "1"],
        ["b", "2"],
      ]),
      0,
    );
    recordResult(state, pair, { state: "slow" }, 0, 1);
    expect(candidates(state, [pair], 600_000)).toEqual([]);
    expect(candidates(state, [pair], 600_001)).toHaveLength(1);
    for (let i = 1; i < 3; i++)
      recordResult(state, { ...pair, key: `p${i}`, a: `${i}` }, { state: "slow" }, i * 10, 1);
    expect(state.paused.get("repo")).toBe(3_600_021);
    expect(candidates(state, [{ ...pair, key: "new", a: "new" }], 999999)).toEqual([]);
    recordResult(state, { ...pair, key: "new", a: "new" }, { state: "clean" }, 999999, 1);
    expect(state.paused.has("repo")).toBe(false);
  });
});
