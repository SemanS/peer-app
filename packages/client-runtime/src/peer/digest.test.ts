import { expect, it } from "@effect/vitest";
import {
  advanceVisit,
  dismissAway,
  sinceFor,
  previewEntries,
  entryText,
  navigationTarget,
  coverageNotice,
  decodeVisit,
  createVisitStore,
} from "./digest.ts";
it("starts an away window only after an hour, keeps it during activity, and resets it after another gap", () => {
  let visit = advanceVisit(null, 0);
  expect(visit.away).toBeUndefined();
  visit = advanceVisit(visit, 20 * 60_000);
  expect(visit.away).toBeUndefined();
  visit = advanceVisit(visit, visit.lastActiveAt + 10 * 3600_000);
  expect(visit.away).toEqual({ since: 20 * 60_000, dismissed: [] });
  const dismissed = dismissAway(visit, "acme/app");
  expect(dismissed.away?.dismissed).toEqual(["acme/app"]);
  const next = advanceVisit(dismissed, dismissed.lastActiveAt + 10_000);
  expect(next.away).toBe(dismissed.away);
  expect(sinceFor(visit, "away", visit.lastActiveAt)).toBe("36000s");
  const reset = advanceVisit(next, next.lastActiveAt + 2 * 3600_000);
  expect(reset.away).toEqual({ since: next.lastActiveAt, dismissed: [] });
  expect(advanceVisit(reset, 0).lastActiveAt).toBe(reset.lastActiveAt);
  expect(sinceFor(visit, "8h", 0)).toBe("8h");
});
it("renders generic previews and honest coverage with safe navigation targets", () => {
  const entry = {
    kind: "future.solved",
    at: "time",
    by: ["ana"],
    subject: "Task",
    ref: { type: "pr", id: "https://github.com/o/r/pull/1" },
  };
  const section = {
    id: "future",
    title: "Future",
    total: 9,
    entries: [entry, entry, entry, entry],
  };
  expect(previewEntries(section, 3)).toEqual({ entries: [entry, entry, entry], remaining: 6 });
  expect(entryText(entry, () => "you")).toBe("Task solved you");
  expect(navigationTarget(entry.ref)).toEqual({ kind: "url", url: entry.ref.id });
  expect(navigationTarget({ type: "pr", id: "javascript:alert(1)" })).toBeNull();
  expect(navigationTarget({ type: "task", id: "a" })).toEqual({ kind: "context", scope: "task:a" });
  expect(navigationTarget({ type: "context", id: "project" })).toEqual({
    kind: "context",
    scope: "project",
  });
  expect(coverageNotice({ complete: false, from: "time" })).toContain("time");
  expect(coverageNotice({ complete: true })).toBeNull();
});
it("stores valid device JSON and avoids unchanged writes", () => {
  expect(decodeVisit("broken")).toBeNull();
  expect(decodeVisit('{"lastActiveAt":"x"}')).toBeNull();
  let raw: string | null = null,
    writes = 0;
  const store = createVisitStore({
    read: () => raw,
    write: (_key, value) => {
      raw = value;
      writes++;
    },
  });
  expect(store.read("ana")).toBeNull();
  const visit = advanceVisit(null, 100);
  store.write("ana", visit);
  store.write("ana", visit);
  expect(writes).toBe(1);
  expect(store.read("ana")).toEqual(visit);
});
