import { describe, expect, it } from "vite-plus/test";

import { agoLabel, clockLabel, dateLabel, lastedLabel, shortWhen } from "./taskTime.logic";

// Local calendar dates throughout, so the day a label falls on does not depend on the machine's zone.
const NOW = new Date(2026, 9, 12, 14, 30).getTime();
const before = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("agoLabel", () => {
  it("counts minutes and hours, then names yesterday and the date", () => {
    expect(agoLabel(before(20_000), NOW)).toBe("just now");
    expect(agoLabel(before(40 * MIN), NOW)).toBe("40 min ago");
    expect(agoLabel(before(2 * HOUR), NOW)).toBe("2 h ago");
    expect(agoLabel(new Date(2026, 9, 11, 9, 0).toISOString(), NOW)).toBe("yesterday");
    expect(agoLabel(new Date(2026, 9, 10, 16, 20).toISOString(), NOW)).toBe("on 10 Oct");
  });

  it("adds the year once it is not this one, and says nothing for a time it cannot read", () => {
    expect(agoLabel(new Date(2025, 11, 24, 8, 0).toISOString(), NOW)).toBe("on 24 Dec 2025");
    expect(agoLabel("not a time", NOW)).toBe("");
  });

  it("reads a time ahead of this clock as now", () => {
    expect(agoLabel(new Date(NOW + 5 * MIN).toISOString(), NOW)).toBe("just now");
  });
});

describe("shortWhen", () => {
  it("is the same in a column, without the word ago", () => {
    expect(shortWhen(before(10_000), NOW)).toBe("Just now");
    expect(shortWhen(before(40 * MIN), NOW)).toBe("40 min");
    expect(shortWhen(before(5 * HOUR), NOW)).toBe("5 h");
    expect(shortWhen(new Date(2026, 9, 11, 9, 0).toISOString(), NOW)).toBe("Yesterday");
    expect(shortWhen(new Date(2026, 9, 10, 16, 20).toISOString(), NOW)).toBe("10 Oct");
  });

  it("counts hours across midnight until a whole day has passed", () => {
    const afterMidnight = new Date(2026, 9, 12, 1, 0).getTime();
    expect(shortWhen(new Date(2026, 9, 11, 23, 0).toISOString(), afterMidnight)).toBe("2 h");
    expect(shortWhen(new Date(2026, 9, 11, 0, 30).toISOString(), afterMidnight)).toBe("Yesterday");
    expect(shortWhen(new Date(2026, 9, 10, 23, 0).toISOString(), afterMidnight)).toBe("10 Oct");
  });
});

describe("lastedLabel", () => {
  it("says how long, and nothing under a minute", () => {
    expect(lastedLabel(before(30_000), NOW)).toBeNull();
    expect(lastedLabel(before(3 * MIN), NOW)).toBe("3 min");
    expect(lastedLabel(before(2 * HOUR + 10 * MIN), NOW)).toBe("2 h");
    expect(lastedLabel(before(50 * HOUR), NOW)).toBe("2 d");
    expect(lastedLabel("nope", NOW)).toBeNull();
  });
});

describe("dateLabel and clockLabel", () => {
  it("write the day and the time of day", () => {
    const created = new Date(2026, 9, 10, 16, 20).toISOString();
    expect(dateLabel(created, NOW)).toBe("10 Oct");
    expect(clockLabel(created)).toBe("16:20");
    expect(dateLabel("nope", NOW)).toBe("");
  });
});
