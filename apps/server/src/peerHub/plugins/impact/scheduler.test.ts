import { describe, expect, it } from "vite-plus/test";
import { createSchedule, createBudget } from "./scheduler.ts";
describe("impact queue budgets", () => {
  it("observations only schedule, debounce the latest edit, and preserve FIFO/rate limits and carry-over", () => {
    const q = createSchedule();
    q.trigger("a", 0);
    q.trigger("b", 1);
    q.trigger("a", 2);
    expect(q.next(5000, () => true)).toBeUndefined();
    expect(q.next(5001, () => true)).toBe("b");
    expect(q.next(5002, () => true)).toBe("a");
    q.trigger("a", 5003);
    expect(q.next(10003, () => true)).toBeUndefined();
    expect(q.next(25002, () => true)).toBe("a");
    q.carry("a", 25003);
    expect(q.next(45002, () => true)).toBeUndefined();
    expect(q.next(45003, () => false)).toBeUndefined();
    expect(q.next(45003, () => true)).toBe("a");
  });
  it("enforces process and wall-time caps before starting another process", () => {
    let now = 0;
    const b = createBudget(() => now);
    for (let i = 0; i < 16; i++) b.take("codegraph");
    expect(() => b.take("codegraph")).toThrow("budget");
    for (let i = 0; i < 3; i++) b.take("git");
    expect(() => b.take("git")).toThrow("budget");
    now = 5000;
    expect(() => b.take("git")).toThrow("budget");
  });
});
