import { describe, expect, it } from "vite-plus/test";

import { agoWords, expiresWords, initialOf, plural, spanWords } from "./words";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("how long a wait has lasted", () => {
  it("says it in the Team page's units: minutes, hours, then days", () => {
    expect(
      [
        0,
        59_999,
        MINUTE,
        18 * MINUTE,
        40 * MINUTE,
        59 * MINUTE,
        HOUR,
        3 * HOUR + 59 * MINUTE,
        23 * HOUR,
        26 * HOUR,
        47 * HOUR,
        2 * DAY,
        6 * DAY + 23 * HOUR,
      ].map(spanWords),
    ).toEqual([
      "now",
      "now",
      "1 min",
      "18 min",
      "40 min",
      "59 min",
      "1 h",
      "3 h",
      "23 h",
      "1 day",
      "1 day",
      "2 days",
      "6 days",
    ]);
  });

  it("reads a time that has not come yet, or none, as now", () => {
    expect(spanWords(-5 * MINUTE)).toBe("now");
    expect(spanWords(Number.NaN)).toBe("now");
  });

  it("says how long ago, and how long is left", () => {
    expect(agoWords(40 * MINUTE)).toBe("40 min ago");
    expect(agoWords(10_000)).toBe("just now");
    expect(expiresWords(6 * DAY + 23 * HOUR)).toBe("expires in 6 days");
    expect(expiresWords(5 * HOUR)).toBe("expires in 5 h");
    expect(expiresWords(30_000)).toBe("expires within a minute");
  });
});

describe("the small words", () => {
  it("counts in singular and plural", () => {
    expect([1, 2, 0].map((count) => plural(count, "task"))).toEqual([
      "1 task",
      "2 tasks",
      "0 tasks",
    ]);
    expect(plural(2, "agent")).toBe("2 agents");
  });

  it("marks a person with their first letter, in capitals", () => {
    expect(initialOf("Ana")).toBe("A");
    expect(initialOf("  éva")).toBe("É");
    expect(initialOf("")).toBe("?");
  });
});
