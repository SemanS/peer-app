/**
 * When a fixed-time scheduled task runs: the first time after an instant and the latest one up to
 * it, in the schedule's time zone. The server decides what runs from these and the settings form
 * shows the same times, so what the form promises and what the scheduler does cannot differ.
 */
import type { ScheduledTaskSchedule } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

type FixedTimeSchedule = Extract<ScheduledTaskSchedule, { readonly type: "fixed_time" }>;

export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * The instant seen in the schedule's time zone, so its time of day and weekdays are that zone's
 * (09:00 stays 09:00 there when the clocks change). A schedule that names no zone keeps the
 * instant's own, which is the computer's; so does one whose name this runtime does not know.
 */
function inScheduleZone(
  schedule: FixedTimeSchedule,
  instant: DateTime.DateTime,
): DateTime.DateTime {
  if (schedule.timeZone === undefined) return instant;
  const zone = DateTime.zoneMakeNamed(schedule.timeZone);
  return Option.isSome(zone) ? DateTime.setZone(instant, zone.value) : instant;
}

/**
 * The closest run after `reference` (direction 1), or at or before it (direction -1), within a week:
 * a weekly schedule has one run in seven days, and none beyond that is closer.
 */
function closestRun(
  schedule: FixedTimeSchedule,
  reference: DateTime.DateTime,
  direction: 1 | -1,
): DateTime.DateTime | null {
  const time = parseTimeOfDay(schedule.timeOfDay);
  if (time === null) return null;
  const weekdays =
    schedule.weekdays && schedule.weekdays.length > 0 ? new Set(schedule.weekdays) : null;
  const start = inScheduleZone(schedule, reference);
  const referenceMs = DateTime.toEpochMillis(reference);
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = DateTime.setParts(DateTime.add(start, { days: direction * offset }), {
      hour: time.hour,
      minute: time.minute,
      second: 0,
      millisecond: 0,
    });
    const candidateMs = DateTime.toEpochMillis(candidate);
    if (direction === 1 ? candidateMs <= referenceMs : candidateMs > referenceMs) continue;
    if (weekdays !== null && !weekdays.has(DateTime.toParts(candidate).weekDay)) continue;
    return candidate;
  }
  return null;
}

/** The first run strictly after `from`; null when the time of day cannot be read. */
export function nextFixedTimeRun(
  schedule: FixedTimeSchedule,
  from: DateTime.DateTime,
): DateTime.DateTime | null {
  return closestRun(schedule, from, 1);
}

/** The latest run at or before `at`: the one a computer that slept until now missed last. */
export function latestFixedTimeRun(
  schedule: FixedTimeSchedule,
  at: DateTime.DateTime,
): DateTime.DateTime | null {
  return closestRun(schedule, at, -1);
}
