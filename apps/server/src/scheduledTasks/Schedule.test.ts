import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { latestFixedTimeRun } from "@t3tools/shared/scheduledTaskRuns";

import {
  isMissedFixedTimeRun,
  isSameSchedule,
  nextScheduledRunAt,
  parseTimeOfDay,
} from "./Schedule.ts";

describe("scheduled task schedule calculation", () => {
  it("parses 24-hour times", () => {
    expect(parseTimeOfDay("09:30")).toEqual({ hour: 9, minute: 30 });
    expect(parseTimeOfDay("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseTimeOfDay("25:00")).toBeNull();
  });

  it("calculates interval schedules from the supplied instant", () => {
    const next = nextScheduledRunAt(
      { type: "interval", everyMs: 5 * 60_000 },
      DateTime.makeUnsafe("2026-07-01T16:00:00.000Z"),
    );
    expect(next ? DateTime.formatIso(DateTime.toUtc(next)) : null).toBe("2026-07-01T16:05:00.000Z");
  });

  it("clamps legacy sub-minute intervals to the one-minute execution floor", () => {
    const next = nextScheduledRunAt(
      { type: "interval", everyMs: 1_000 },
      DateTime.makeUnsafe("2026-07-01T16:00:00.000Z"),
    );
    expect(next ? DateTime.formatIso(DateTime.toUtc(next)) : null).toBe("2026-07-01T16:01:00.000Z");
  });

  it("skips to the next matching fixed-time weekday", () => {
    const next = nextScheduledRunAt(
      { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
      DateTime.makeZonedUnsafe(
        {
          year: 2026,
          month: 7,
          day: 3,
          hour: 10,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
        { timeZone: "America/Los_Angeles", adjustForTimeZone: true },
      ),
    );
    const parts = next ? DateTime.toParts(next) : null;
    expect(parts?.weekDay).toBe(1);
    expect(parts?.hour).toBe(9);
    expect(parts?.minute).toBe(0);
  });

  it("skips fixed-time runs missed by more than the grace window", () => {
    const fixedTime = { type: "fixed_time", timeOfDay: "09:00" } as const;
    const dueAt = DateTime.makeUnsafe("2026-07-01T09:00:00.000Z");
    const withinGrace = DateTime.makeUnsafe("2026-07-01T09:05:00.000Z");
    const pastGrace = DateTime.makeUnsafe("2026-07-01T15:00:00.000Z");
    // A run only slightly late (poll jitter, short sleep) still fires.
    expect(isMissedFixedTimeRun(fixedTime, dueAt, withinGrace)).toBe(false);
    // A run hours past its slot is skipped and rescheduled instead.
    expect(isMissedFixedTimeRun(fixedTime, dueAt, pastGrace)).toBe(true);
    // Interval schedules always catch up with a single run, never skip.
    expect(isMissedFixedTimeRun({ type: "interval", everyMs: 60_000 }, dueAt, pastGrace)).toBe(
      false,
    );
  });

  describe("in a time zone of its own", () => {
    const weekdays = [1, 2, 3, 4, 5];
    const bratislava = {
      type: "fixed_time",
      timeOfDay: "09:00",
      weekdays,
      timeZone: "Europe/Bratislava",
    } as const;
    const iso = (value: DateTime.DateTime | null) =>
      value === null ? null : DateTime.formatIso(DateTime.toUtc(value));

    it("runs at the zone's time of day whatever zone the clock reads in", () => {
      // Monday 12 Oct 2026, 16:27 in Bratislava (CEST, UTC+2).
      const monday = DateTime.makeUnsafe("2026-10-12T14:27:00.000Z");
      expect(iso(nextScheduledRunAt(bratislava, monday))).toBe("2026-10-13T07:00:00.000Z");
      for (const zone of ["America/Los_Angeles", "Asia/Tokyo", "UTC"]) {
        expect(iso(nextScheduledRunAt(bratislava, DateTime.setZoneNamedUnsafe(monday, zone)))).toBe(
          "2026-10-13T07:00:00.000Z",
        );
      }
      expect(iso(nextScheduledRunAt({ ...bratislava, timeZone: "America/New_York" }, monday))).toBe(
        "2026-10-13T13:00:00.000Z",
      );
    });

    it("takes the weekdays in the zone, not in the clock's", () => {
      // Friday 16 Oct 2026 22:30 UTC is already Saturday 00:30 in Bratislava: Monday is next.
      const friday = DateTime.makeUnsafe("2026-10-16T22:30:00.000Z");
      expect(iso(nextScheduledRunAt(bratislava, friday))).toBe("2026-10-19T07:00:00.000Z");
      // In UTC it is still Friday, and the weekday rule is Monday to Friday: Saturday's run is out.
      expect(iso(nextScheduledRunAt({ ...bratislava, timeZone: "UTC" }, friday))).toBe(
        "2026-10-19T09:00:00.000Z",
      );
    });

    it("keeps the time of day when the zone's clocks change", () => {
      const daily = {
        type: "fixed_time",
        timeOfDay: "09:00",
        timeZone: "Europe/Bratislava",
      } as const;
      // Clocks go back on Sunday 25 Oct 2026: 09:00 is 07:00Z before it and 08:00Z after.
      const saturday = DateTime.makeUnsafe("2026-10-24T08:30:00.000Z");
      expect(iso(nextScheduledRunAt(daily, saturday))).toBe("2026-10-25T08:00:00.000Z");
      expect(iso(nextScheduledRunAt(daily, DateTime.makeUnsafe("2026-10-25T08:00:00.000Z")))).toBe(
        "2026-10-26T08:00:00.000Z",
      );
      // And forward on Sunday 29 Mar 2026: 09:00 is 08:00Z before it and 07:00Z after.
      expect(iso(nextScheduledRunAt(daily, DateTime.makeUnsafe("2026-03-28T08:30:00.000Z")))).toBe(
        "2026-03-29T07:00:00.000Z",
      );
    });

    it("falls back to the clock's zone for a name this runtime does not know", () => {
      const from = DateTime.makeUnsafe("2026-10-12T14:27:00.000Z");
      expect(iso(nextScheduledRunAt({ ...bratislava, timeZone: "Mars/Olympus_Mons" }, from))).toBe(
        iso(nextScheduledRunAt({ ...bratislava, timeZone: "UTC" }, from)),
      );
    });

    it("finds the latest run up to an instant in the same zone", () => {
      // Wednesday 14 Oct 2026, 10:00 in Bratislava: today's 09:00 has passed.
      const wednesday = DateTime.makeUnsafe("2026-10-14T08:00:00.000Z");
      expect(iso(latestFixedTimeRun(bratislava, wednesday))).toBe("2026-10-14T07:00:00.000Z");
      // Saturday 17 Oct 2026, 10:00: the weekend has no run, so Friday's is the latest.
      const saturday = DateTime.makeUnsafe("2026-10-17T08:00:00.000Z");
      expect(iso(latestFixedTimeRun(bratislava, saturday))).toBe("2026-10-16T07:00:00.000Z");
      // Monday 08:00 in Bratislava, before that day's run: the one before it is Friday's.
      const earlyMonday = DateTime.makeUnsafe("2026-10-19T06:00:00.000Z");
      expect(iso(latestFixedTimeRun(bratislava, earlyMonday))).toBe("2026-10-16T07:00:00.000Z");
      // A weekly schedule reaches back a whole week.
      const weekly = {
        type: "fixed_time",
        timeOfDay: "09:00",
        weekdays: [1],
        timeZone: "UTC",
      } as const;
      expect(iso(latestFixedTimeRun(weekly, DateTime.makeUnsafe("2026-10-19T08:00:00.000Z")))).toBe(
        "2026-10-12T09:00:00.000Z",
      );
    });
  });

  describe("a run the computer slept through", () => {
    // A daily 09:00 in UTC; the stored run was due on Monday 12 Oct 2026 at 09:00.
    const dueAt = DateTime.makeUnsafe("2026-10-12T09:00:00.000Z");
    const at = (value: string) => DateTime.makeUnsafe(value);
    const daily = { type: "fixed_time", timeOfDay: "09:00", timeZone: "UTC" } as const;
    const catchUp = (hours: number) =>
      ({ ...daily, missedRun: { type: "catch_up", withinMs: hours * 3_600_000 } }) as const;

    it("runs a late poll in every case, and skips a long sleep unless asked to catch up", () => {
      const justLate = at("2026-10-12T09:05:00.000Z");
      for (const schedule of [
        daily,
        { ...daily, missedRun: { type: "skip" } } as const,
        catchUp(6),
      ]) {
        expect(isMissedFixedTimeRun(schedule, dueAt, justLate)).toBe(false);
      }
      const wokeAtNoon = at("2026-10-12T12:00:00.000Z");
      expect(isMissedFixedTimeRun(daily, dueAt, wokeAtNoon)).toBe(true);
      expect(
        isMissedFixedTimeRun({ ...daily, missedRun: { type: "skip" } }, dueAt, wokeAtNoon),
      ).toBe(true);
    });

    it("catches up when the computer wakes within the window of the missed time", () => {
      expect(isMissedFixedTimeRun(catchUp(6), dueAt, at("2026-10-12T14:59:00.000Z"))).toBe(false);
      expect(isMissedFixedTimeRun(catchUp(6), dueAt, at("2026-10-12T15:01:00.000Z"))).toBe(true);
      expect(isMissedFixedTimeRun(catchUp(12), dueAt, at("2026-10-12T15:01:00.000Z"))).toBe(false);
      expect(isMissedFixedTimeRun(catchUp(2), dueAt, at("2026-10-12T12:00:00.000Z"))).toBe(true);
    });

    it("counts the latest missed run, not the oldest, when several were slept through", () => {
      // Woke on Wednesday at 10:00: Monday's stored run is two days old, but Wednesday's own
      // run (09:00) was an hour ago, so one run now covers them.
      const wednesday = at("2026-10-14T10:00:00.000Z");
      expect(isMissedFixedTimeRun(catchUp(6), dueAt, wednesday)).toBe(false);
      expect(isMissedFixedTimeRun(daily, dueAt, wednesday)).toBe(true);
      // Woke at 16:00, seven hours after that day's run: nothing is recent enough.
      expect(isMissedFixedTimeRun(catchUp(6), dueAt, at("2026-10-14T16:00:00.000Z"))).toBe(true);
    });

    it("reads the window in the schedule's zone", () => {
      // 09:00 in Bratislava (CEST) is 07:00Z; waking at 12:30Z is 5.5 h later.
      const bratislava = {
        type: "fixed_time",
        timeOfDay: "09:00",
        timeZone: "Europe/Bratislava",
        missedRun: { type: "catch_up", withinMs: 6 * 3_600_000 },
      } as const;
      const due = at("2026-10-12T07:00:00.000Z");
      expect(isMissedFixedTimeRun(bratislava, due, at("2026-10-12T12:30:00.000Z"))).toBe(false);
      expect(isMissedFixedTimeRun(bratislava, due, at("2026-10-12T13:30:00.000Z"))).toBe(true);
    });
  });

  it("compares schedules structurally", () => {
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 60_000 }),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 30_000 }),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
      ),
    ).toBe(true);
    // Weekday masks are sets: order and duplicates do not change firing.
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [5, 1] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 5, 5] },
      ),
    ).toBe(true);
    // Omitted, empty, and all-seven masks all mean daily.
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [] },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3] },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:30" },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "interval", everyMs: 60_000 },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(false);
  });

  it("compares time zones, resolving a missing one to the computer's, and ignores missed-run rules", () => {
    const base = { type: "fixed_time", timeOfDay: "09:00" } as const;
    expect(isSameSchedule(base, { ...base, timeZone: "UTC" })).toBe(false);
    expect(isSameSchedule(base, { ...base, timeZone: "Europe/Bratislava" })).toBe(false);
    expect(
      isSameSchedule(base, { ...base, timeZone: "Europe/Bratislava" }, "Europe/Bratislava"),
    ).toBe(true);
    expect(isSameSchedule(base, { ...base, timeZone: "UTC" }, "Europe/Bratislava")).toBe(false);
    expect(
      isSameSchedule(
        { ...base, missedRun: { type: "skip" } },
        { ...base, missedRun: { type: "catch_up", withinMs: 3_600_000 } },
      ),
    ).toBe(true);
  });

  it.each([
    ["9:00", "09:00"],
    ["09:00", "9:00"],
    ["0:30", "00:30"],
  ])("treats %s and %s as the same fixed-time schedule", (before, after) => {
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: before },
        { type: "fixed_time", timeOfDay: after },
      ),
    ).toBe(true);
  });
});
