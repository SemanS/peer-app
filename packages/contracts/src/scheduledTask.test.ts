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

  it("accepts a one-time run only with an offset", () => {
    for (const runAt of ["2026-11-03T09:00Z", "2026-11-03T09:00:00.000-08:00"]) {
      expect(decodeUpsertSchedule({ type: "once", runAt })).toEqual({ type: "once", runAt });
    }
    for (const runAt of [
      "2026-11-03T09:00",
      "2026-13-03T09:00Z",
      "2026-02-30T09:00Z",
      "9999-12-31T23:30-01:00",
      "0000-01-01T00:00+00:01",
      "tomorrow",
    ]) {
      expect(() => decodeUpsertSchedule({ type: "once", runAt })).toThrow();
    }
  });
});

it.each(["literal", " ", "\t\n", "{{body.bad", "{{unknown.field}}"])(
  "rejects invalid dedupe template %s",
  (replayKey) => {
    expect(() => decodeUpsertSchedule({ type: "webhook", dedupe: { replayKey } })).toThrow();
    expect(() =>
      decodeUpsertSchedule({ type: "webhook", dedupe: { coalesceKey: replayKey } }),
    ).toThrow();
  },
);
describe("webhook filters", () => {
  const accepts = (filters: unknown) => {
    try {
      decodeUpsertSchedule({ type: "webhook", filters });
      return true;
    } catch {
      return false;
    }
  };

  it("rejects empty or unknown paths, unknown ops, and values that do not fit the op", () => {
    expect(accepts([{ path: "", op: "exists" }])).toBe(false);
    expect(accepts([{ path: "  ", op: "exists" }])).toBe(false);
    expect(accepts([{ path: "request", op: "exists" }])).toBe(false);
    expect(accepts([{ path: "header.x-github-event", op: "exists" }])).toBe(false);
    expect(accepts([{ path: "body.action", op: "in", value: "opened" }])).toBe(false);
    expect(accepts([{ path: "body.action", op: "in", value: [] }])).toBe(false);
    for (const value of ["", " opened", "opened ", "a,b"]) {
      expect(accepts([{ path: "body.action", op: "in", value: [value] }])).toBe(false);
    }
    expect(accepts([{ path: "body.label.name", op: "in", value: ["needs review"] }])).toBe(true);
    expect(accepts([{ path: "body.action", op: "equals" }])).toBe(false);
    expect(accepts([{ path: "body.action", op: "matches", value: "^opened$" }])).toBe(false);
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
