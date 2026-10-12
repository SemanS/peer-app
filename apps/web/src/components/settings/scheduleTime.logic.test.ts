import { describe, expect, it } from "vite-plus/test";

import {
  catchUpChoices,
  nextRunPreview,
  offsetLabel,
  untilLabel,
  zoneAbbreviation,
  zoneLabel,
  windowLabel,
  zoneNames,
} from "./scheduleTime.logic";

// Monday 12 Oct 2026, 16:27 in Bratislava (CEST, UTC+2).
const MONDAY = Date.parse("2026-10-12T14:27:00.000Z");
const WEEKDAYS = new Set([1, 2, 3, 4, 5]);

describe("a zone in words", () => {
  it("names a zone with its short name and offset where the browser knows them", () => {
    expect(zoneLabel("Europe/Bratislava", MONDAY)).toBe("Europe/Bratislava · CEST, UTC+2");
    expect(zoneLabel("Europe/London", MONDAY)).toBe("Europe/London · BST, UTC+1");
    expect(zoneLabel("America/New_York", MONDAY)).toBe("America/New_York · EDT, UTC−4");
    expect(zoneLabel("UTC", MONDAY)).toBe("UTC");
  });

  it("gives a zone with no short name of its own by its offset", () => {
    expect(zoneAbbreviation("Asia/Tokyo", MONDAY)).toBe("UTC+9");
    expect(zoneLabel("Asia/Tokyo", MONDAY)).toBe("Asia/Tokyo · UTC+9");
    expect(zoneLabel("Asia/Kolkata", MONDAY)).toBe("Asia/Kolkata · UTC+5:30");
  });

  it("follows the clocks: the same zone has another short name in winter", () => {
    expect(zoneAbbreviation("Europe/Bratislava", Date.parse("2026-12-01T12:00:00Z"))).toBe("CET");
  });

  it("leaves a name the browser does not know as it is", () => {
    expect(zoneLabel("Mars/Olympus_Mons", MONDAY)).toBe("Mars/Olympus_Mons");
    expect(offsetLabel(-210)).toBe("UTC−3:30");
  });

  it("lists UTC first, the saved zone next, then the known ones once each", () => {
    expect(zoneNames("", ["Europe/Bratislava", "UTC", "Asia/Tokyo"])).toEqual([
      "UTC",
      "Europe/Bratislava",
      "Asia/Tokyo",
    ]);
    expect(zoneNames("Pacific/Chatham", ["Europe/Bratislava"])).toEqual([
      "UTC",
      "Pacific/Chatham",
      "Europe/Bratislava",
    ]);
    expect(zoneNames("", [])).toContain("Europe/London");
  });
});

describe("how long a missed run may still be caught up", () => {
  const hours = (n: number) => n * 3_600_000;

  it("offers the usual windows and keeps a saved one of another length", () => {
    expect(catchUpChoices(hours(6))).toEqual([hours(2), hours(6), hours(12)]);
    expect(catchUpChoices(hours(4))).toEqual([hours(2), hours(4), hours(6), hours(12)]);
    expect(catchUpChoices(90 * 60_000).map(windowLabel)).toEqual([
      "90 minutes",
      "2 hours",
      "6 hours",
      "12 hours",
    ]);
  });

  it("puts a window in words", () => {
    expect(windowLabel(hours(1))).toBe("1 hour");
    expect(windowLabel(hours(6))).toBe("6 hours");
    expect(windowLabel(60_000)).toBe("1 minute");
  });
});

describe("the next runs", () => {
  it("says the next run with its date, time, zone and how long it is", () => {
    expect(
      nextRunPreview({
        timeOfDay: "09:00",
        weekdays: WEEKDAYS,
        zone: "Europe/Bratislava",
        now: MONDAY,
      }),
    ).toEqual({
      next: "Tue 13 Oct, 09:00 CEST — in 17 h",
      following: "Then Wed 14 Oct, Thu 15 Oct …",
      note: "Follows Bratislava time: it stays at 09:00 there when the clocks change.",
    });
  });

  it("reads the same schedule in another zone", () => {
    const preview = nextRunPreview({
      timeOfDay: "09:00",
      weekdays: WEEKDAYS,
      zone: "America/New_York",
      now: MONDAY,
    });
    expect(preview?.next).toBe("Tue 13 Oct, 09:00 EDT — in 23 h");
  });

  it("skips the weekend and counts days once a run is far off", () => {
    // Friday 16 Oct 2026, 16:00 in Bratislava: the next run is Monday.
    const friday = Date.parse("2026-10-16T14:00:00.000Z");
    expect(
      nextRunPreview({
        timeOfDay: "09:00",
        weekdays: WEEKDAYS,
        zone: "Europe/Bratislava",
        now: friday,
      })?.next,
    ).toBe("Mon 19 Oct, 09:00 CEST — in 3 days");
    expect(
      nextRunPreview({ timeOfDay: "09:00", weekdays: new Set([1]), zone: "UTC", now: friday })
        ?.next,
    ).toBe("Mon 19 Oct, 09:00 UTC — in 3 days");
  });

  it("follows the zone's clocks across a change", () => {
    // Saturday 24 Oct 2026 11:00 CEST; clocks go back that night, so 09:00 is 08:00Z after it.
    const saturday = Date.parse("2026-10-24T09:00:00.000Z");
    const preview = nextRunPreview({
      timeOfDay: "09:00",
      weekdays: new Set(),
      zone: "Europe/Bratislava",
      now: saturday,
    });
    expect(preview?.next).toBe("Sun 25 Oct, 09:00 CET — in 23 h");
  });

  it("says a zone without summer time never shifts", () => {
    expect(
      nextRunPreview({ timeOfDay: "09:00", weekdays: WEEKDAYS, zone: "UTC", now: MONDAY })?.note,
    ).toBe("UTC never changes for summer time.");
    expect(
      nextRunPreview({ timeOfDay: "09:00", weekdays: WEEKDAYS, zone: "Asia/Tokyo", now: MONDAY })
        ?.note,
    ).toBe("Tokyo has no summer time, so this never shifts.");
  });

  it("promises nothing for a time that is not one or a zone nobody knows", () => {
    expect(
      nextRunPreview({ timeOfDay: "", weekdays: WEEKDAYS, zone: "UTC", now: MONDAY }),
    ).toBeNull();
    expect(
      nextRunPreview({
        timeOfDay: "09:00",
        weekdays: WEEKDAYS,
        zone: "Mars/Olympus_Mons",
        now: MONDAY,
      }),
    ).toBeNull();
  });

  it("rounds how long to hours, days, and minutes near the time", () => {
    expect(untilLabel(30_000)).toBe("in under a minute");
    expect(untilLabel(12 * 60_000)).toBe("in 12 min");
    expect(untilLabel(16.55 * 3_600_000)).toBe("in 17 h");
    expect(untilLabel(36 * 3_600_000)).toBe("in 36 h");
    expect(untilLabel(37 * 3_600_000)).toBe("in 2 days");
  });
});
