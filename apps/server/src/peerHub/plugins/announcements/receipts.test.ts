import { describe, expect, it } from "@effect/vitest";
import { makeOutbox } from "./receipts.ts";
const receipt = (
  announcement: string,
  state: "offered" | "modelInput" | "acknowledged" = "offered",
) => ({ workspace: "acme", project: "app", announcement, session: "claude:one", state });
describe("announcement receipt outbox", () => {
  it("coalesces, waits two seconds and batches at most 100", () => {
    const box = makeOutbox();
    box.add(receipt("one"), 1000);
    box.add(receipt("one"), 1500);
    expect(box.due(2999)).toBe(false);
    expect(box.due(3000)).toBe(true);
    for (let n = 0; n < 120; n++) box.add(receipt(`${n}`), 2000);
    expect(box.batch("acme")).toHaveLength(100);
    expect(box.size()).toBe(121);
  });
  it("drops the oldest at 500 and retries without losing receipts", () => {
    const box = makeOutbox();
    for (let n = 0; n < 501; n++) box.add(receipt(`${n}`), 1000);
    expect(box.size()).toBe(500);
    expect(box.batch("acme")[0]?.announcement).toBe("1");
    box.failed(3000);
    expect(box.due(12999)).toBe(false);
    expect(box.due(13000)).toBe(true);
    box.failed(13000);
    expect(box.due(42999)).toBe(false);
    expect(box.due(43000)).toBe(true);
    box.failed(43000);
    expect(box.due(103000)).toBe(true);
    const batch = box.batch("acme");
    box.accepted(batch, 103000);
    expect(box.size()).toBe(400);
  });
  it("retains newer entries queued while a batch is in flight and isolates memberships", () => {
    const box = makeOutbox();
    box.add(receipt("one"), 0);
    const batch = box.batch("acme");
    box.add(receipt("one"), 100);
    box.add({ ...receipt("two"), workspace: "other" }, 100);
    box.accepted(batch, 200);
    expect(box.size()).toBe(2);
    box.forget(new Set(["other"]));
    expect(box.batch("acme")).toEqual([]);
    expect(box.size()).toBe(1);
  });
});
