import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  MIN_SCHEDULED_TASK_INTERVAL_MS,
  ScheduledTaskListResult,
  ScheduledTaskSchedule,
  ScheduledTaskUpsertSchedule,
} from "./scheduledTask.ts";

const decodeSchedule = Schema.decodeUnknownSync(ScheduledTaskSchedule);
const decodeUpsertSchedule = Schema.decodeUnknownSync(ScheduledTaskUpsertSchedule);
const decodeList = Schema.decodeUnknownSync(ScheduledTaskListResult);

describe("ScheduledTaskSchedule", () => {
  it("keeps legacy sub-minute persisted schedules readable", () => {
    expect(
      decodeSchedule({
        type: "interval",
        everyMs: MIN_SCHEDULED_TASK_INTERVAL_MS - 1,
      }),
    ).toEqual({
      type: "interval",
      everyMs: MIN_SCHEDULED_TASK_INTERVAL_MS - 1,
    });
  });

  it("still rejects corrupt non-positive persisted intervals", () => {
    expect(() => decodeSchedule({ type: "interval", everyMs: 0 })).toThrow();
  });
});

describe("ScheduledTaskUpsertSchedule", () => {
  it("accepts interval schedules at the one-minute minimum", () => {
    expect(
      decodeUpsertSchedule({
        type: "interval",
        everyMs: MIN_SCHEDULED_TASK_INTERVAL_MS,
      }),
    ).toEqual({
      type: "interval",
      everyMs: MIN_SCHEDULED_TASK_INTERVAL_MS,
    });
  });

  it("rejects interval schedules more frequent than once per minute", () => {
    expect(() =>
      decodeUpsertSchedule({
        type: "interval",
        everyMs: MIN_SCHEDULED_TASK_INTERVAL_MS - 1,
      }),
    ).toThrow();
  });
});

describe("fixed-time schedules with a time zone and a missed-run rule", () => {
  const stored = { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] } as const;

  it("reads a record from before them as it was, without adding either", () => {
    expect(decodeSchedule(stored)).toEqual(stored);
    expect(Object.keys(decodeSchedule(stored))).toEqual(["type", "timeOfDay", "weekdays"]);
    expect(Object.keys(decodeUpsertSchedule(stored))).toEqual(["type", "timeOfDay", "weekdays"]);
  });

  it("reads and writes a time zone with either rule", () => {
    const catchUp = {
      ...stored,
      timeZone: "Europe/Bratislava",
      missedRun: { type: "catch_up", withinMs: 6 * 60 * 60_000 },
    };
    expect(decodeSchedule(catchUp)).toEqual(catchUp);
    expect(decodeUpsertSchedule(catchUp)).toEqual(catchUp);
    const skip = { ...stored, missedRun: { type: "skip" } };
    expect(decodeUpsertSchedule(skip)).toEqual(skip);
  });

  it("refuses a rule it does not know, or a catch-up window that is empty or longer than a week", () => {
    for (const missedRun of [
      { type: "retry" },
      { type: "catch_up" },
      { type: "catch_up", withinMs: 0 },
      { type: "catch_up", withinMs: 8 * 24 * 60 * 60_000 },
    ]) {
      expect(() => decodeSchedule({ ...stored, missedRun })).toThrow();
    }
    expect(() => decodeSchedule({ ...stored, timeZone: "" })).toThrow();
  });

  it("lists tasks from a server that does not report its time zone", () => {
    expect(decodeList({ tasks: [] })).toEqual({ tasks: [] });
    expect(decodeList({ tasks: [], timeZone: "Europe/Bratislava" })).toEqual({
      tasks: [],
      timeZone: "Europe/Bratislava",
    });
  });
});
