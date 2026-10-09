import { expect, it } from "@effect/vitest";
import { createVisitStore, advanceVisit } from "@t3tools/client-runtime/peer-digest";
import { makeVisitTracker } from "./visitTracker";
it("loads invalid storage quietly, writes only changed activity, and notifies only an away change", () => {
  let raw: string | null = "broken",
    writes = 0,
    woken = 0;
  const store = createVisitStore({
      read: () => raw,
      write: (_key, value) => {
        raw = value;
        writes++;
      },
    }),
    tracker = makeVisitTracker(store);
  expect(tracker.get("ana")).toBeNull();
  tracker.subscribe(() => woken++);
  const release = tracker.activate("ana", 100);
  expect(writes).toBe(1);
  tracker.signal(100);
  expect(writes).toBe(1);
  expect(woken).toBe(0);
  tracker.signal(100 + 2 * 3600_000);
  expect(woken).toBe(1);
  expect(tracker.get("ana")?.away?.since).toBe(100);
  tracker.dismiss("ana", "acme/app");
  expect(woken).toBe(2);
  release();
  tracker.signal(100 + 10 * 3600_000);
  expect(tracker.get("ana")).toEqual({
    ...advanceVisit(advanceVisit(null, 100), 100 + 2 * 3600_000),
    away: { since: 100, dismissed: ["acme/app"] },
  });
});
