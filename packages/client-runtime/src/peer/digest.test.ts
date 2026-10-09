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
  automaticSinceFor,
  createActivityVisits,
} from "./digest.ts";
it("starts an away window only after an hour, keeps it during activity, and resets it after another gap", () => {
  let visit = advanceVisit(null, 0);
  expect(visit.away).toBeUndefined();
  visit = advanceVisit(visit, 20 * 60_000);
  expect(visit.away).toBeUndefined();
  visit = advanceVisit(visit, visit.lastActiveAt + 10 * 3600_000);
  expect(visit.away).toEqual({ since: 20 * 60_000, dismissed: [], durationSeconds: 36000 });
  const dismissed = dismissAway(visit, "acme/app");
  expect(dismissed.away?.dismissed).toEqual(["acme/app"]);
  const next = advanceVisit(dismissed, dismissed.lastActiveAt + 10_000);
  expect(next.away).toBe(dismissed.away);
  expect(sinceFor(visit, "away", visit.lastActiveAt)).toBe("36000s");
  const reset = advanceVisit(next, next.lastActiveAt + 2 * 3600_000);
  expect(reset.away).toEqual({ since: next.lastActiveAt, dismissed: [], durationSeconds: 7200 });
  expect(advanceVisit(reset, 0).lastActiveAt).toBe(reset.lastActiveAt);
  expect(sinceFor(visit, "8h", 0)).toBe("8h");
});
it("asks automatic windows by a stable duration, leaving the Hub to resolve its own clock", () => {
  const returned = advanceVisit({ lastActiveAt: 20 * 60_000 }, 20 * 60_000 + 10 * 3600_000);
  expect(automaticSinceFor(returned)).toBe("36000s");
  const active = advanceVisit(returned, returned.lastActiveAt + 5 * 60_000);
  expect(automaticSinceFor(active)).toBe("36000s");
  expect(sinceFor(active, "away", active.lastActiveAt)).toBe("36300s");
  const previousShape = { lastActiveAt: 1000, away: { since: 0, dismissed: [] } };
  const restored = advanceVisit(previousShape, 2000);
  expect(automaticSinceFor(advanceVisit(restored, 3000))).toBe("2s");
  expect(automaticSinceFor(advanceVisit(null, 0))).toBeNull();
  expect(decodeVisit(JSON.stringify(restored))).toEqual(restored);
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
it("reopens the original away window after a reload without changing active query keys on heartbeat", () => {
  let stored = advanceVisit({ lastActiveAt: 0 }, 10 * 3600_000);
  const visits = createActivityVisits({
    read: () => stored,
    write: (_email, value) => {
      stored = value;
    },
  });
  const release = visits.activate("ana", 10 * 3600_000);
  visits.signal(10 * 3600_000 + 5 * 60_000);
  expect(automaticSinceFor(visits.get("ana"))).toBe("36000s");
  release();
  const again = visits.activate("ana", 10 * 3600_000 + 10 * 60_000);
  expect(automaticSinceFor(visits.get("ana"))).toBe("36600s");
  expect(visits.get("ana")?.away?.since).toBe(0);
  again();
});
