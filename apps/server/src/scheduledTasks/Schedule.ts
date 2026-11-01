import { MIN_SCHEDULED_TASK_INTERVAL_MS, type ScheduledTaskSchedule } from "@t3tools/contracts";
import {
  latestFixedTimeRun,
  nextFixedTimeRun,
  parseTimeOfDay,
} from "@t3tools/shared/scheduledTaskRuns";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const MINUTE_MS = 60_000;

export function nextScheduledRunAt(
  schedule: ScheduledTaskSchedule,
  from: DateTime.DateTime,
): DateTime.DateTime | null {
  if (schedule.type === "webhook") return null;
  if (schedule.type === "once") {
    const runAt = DateTime.make(schedule.runAt);
    return Option.isSome(runAt) &&
      DateTime.toEpochMillis(runAt.value) > DateTime.toEpochMillis(from)
      ? runAt.value
      : null;
  }
  if (schedule.type === "interval") {
    // Intervals advance elapsed time, including across daylight-saving changes.
    return DateTime.addDuration(from, Math.max(schedule.everyMs, MIN_SCHEDULED_TASK_INTERVAL_MS));
  }

  return nextFixedTimeRun(schedule, from);
}

function weekdayKey(weekdays: ReadonlyArray<number> | undefined): string {
  const unique = [...new Set(weekdays ?? [])].toSorted((x, y) => x - y);
  if (unique.length === 0 || unique.length === 7) return "daily";
  return unique.join(",");
}

/**
 * Semantic equality for schedules: true iff both fire at the same times. A schedule without a time
 * zone fires in `localZone`, the computer's, when the caller knows it. How a missed run is handled
 * does not change when the schedule fires, so it is not compared.
 */
export function isSameSchedule(
  a: ScheduledTaskSchedule,
  b: ScheduledTaskSchedule,
  localZone?: string,
): boolean {
  if (a.type === "interval") {
    return b.type === "interval" && a.everyMs === b.everyMs;
  }
  if (a.type === "webhook") return b.type === "webhook";
  if (a.type === "once") return b.type === "once" && Date.parse(a.runAt) === Date.parse(b.runAt);
  if (b.type !== "fixed_time") return false;
  // Compare parsed times so padded-hour edits do not reschedule pending runs.
  const aTime = parseTimeOfDay(a.timeOfDay);
  const bTime = parseTimeOfDay(b.timeOfDay);
  return (
    aTime !== null &&
    bTime !== null &&
    aTime.hour === bTime.hour &&
    aTime.minute === bTime.minute &&
    weekdayKey(a.weekdays) === weekdayKey(b.weekdays) &&
    (a.timeZone ?? localZone) === (b.timeZone ?? localZone)
  );
}

const MISSED_FIXED_TIME_GRACE_MS = 10 * MINUTE_MS;

/**
 * True when a due fixed-time run is past the grace window and moves to its next occurrence instead
 * of firing. A schedule that asks to catch up runs once when its latest run up to now is recent
 * enough, even if the stored one is older. Interval schedules are never missed: an overdue interval
 * task catching up with a single run is the desired behaviour.
 */
export function isMissedFixedTimeRun(
  schedule: ScheduledTaskSchedule,
  dueAt: DateTime.DateTime,
  now: DateTime.DateTime,
): boolean {
  if (schedule.type !== "fixed_time") return false;
  const nowMs = DateTime.toEpochMillis(now);
  if (nowMs - DateTime.toEpochMillis(dueAt) <= MISSED_FIXED_TIME_GRACE_MS) return false;
  if (schedule.missedRun?.type !== "catch_up") return true;
  const latest = latestFixedTimeRun(schedule, now);
  return (
    latest === null ||
    nowMs - DateTime.toEpochMillis(latest) >
      Math.max(MISSED_FIXED_TIME_GRACE_MS, schedule.missedRun.withinMs)
  );
}
