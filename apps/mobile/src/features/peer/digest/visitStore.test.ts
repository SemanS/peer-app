import { expect, it } from "@effect/vitest";
import { makeMobileVisits, readMobileVisit } from "./visitStore";
it("persists person-specific JSON at most every five minutes and flushes on background", () => {
  const stored = new Map<string, string>();
  let writes = 0;
  const visits = makeMobileVisits({
    read: (email) => stored.get(email) ?? null,
    write: (email, value) => {
      stored.set(email, value);
      writes++;
    },
  });
  expect(readMobileVisit("broken")).toBeNull();
  const stop = visits.activate("ana", 0);
  visits.signal(1000);
  visits.signal(2000);
  expect(writes).toBe(1);
  visits.signal(2000, true);
  expect(writes).toBe(2);
  expect(readMobileVisit(stored.get("ana")!)?.lastActiveAt).toBe(2000);
  visits.signal(302000);
  expect(writes).toBe(3);
  expect(stored.has("bob")).toBe(false);
  stop();
});
