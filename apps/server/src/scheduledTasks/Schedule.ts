import { MIN_SCHEDULED_TASK_INTERVAL_MS, type ScheduledTaskSchedule } from "@t3tools/contracts";
import {
  latestFixedTimeRun,
  nextFixedTimeRun,
  parseTimeOfDay,
} from "@t3tools/shared/scheduledTaskRuns";
import * as DateTime from "effect/DateTime";

export { parseTimeOfDay };

const MINUTE_MS = 60_000;

export function nextScheduledRunAt(
  schedule: ScheduledTaskSchedule,
  from: DateTime.DateTime,
): DateTime.DateTime | null {
  if (schedule.type === "interval") {
    // Persisted rows created before the one-minute floor remain readable, but
    // they must not retain their old high-frequency execution rate.
    return DateTime.add(from, {
      milliseconds: Math.max(schedule.everyMs, MIN_SCHEDULED_TASK_INTERVAL_MS),
    });
  }

  return nextFixedTimeRun(schedule, from);
}

/**
 * Canonical form of a weekday mask, mirroring how `nextScheduledRunAt` reads
 * it: order and duplicates are irrelevant, and an empty/omitted mask means the
 * same as explicitly listing all seven days — daily.
 */
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
  if (b.type !== "fixed_time") return false;
  // The contract accepts padded and unpadded hours ("9:00" and "09:00"), so
  // compare the parsed time — string equality would treat a format-only edit
  // as a schedule change and recompute the pending run.
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

/**
 * How late a fixed-time run may fire before it counts as missed. Covers poll
 * jitter and short sleeps, while a server booted hours after the slot skips
 * to the next occurrence instead of firing stale work at a random time.
 */
const MISSED_FIXED_TIME_GRACE_MS = 10 * MINUTE_MS;

/**
 * True when a due fixed-time run was missed and should be rescheduled to its
 * next occurrence instead of firing now: it is later than the grace window,
 * and the schedule does not ask to catch up. A schedule that does catches up
 * with one run when the latest of its runs up to now is recent enough, even
 * if the stored one is older (a computer that slept through several runs
 * does one, not several). Interval schedules are never considered missed: an
 * overdue interval task catching up with a single run is the desired
 * behaviour.
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

function describeSchedule(schedule: ScheduledTaskSchedule): string {
  if (schedule.type === "interval") {
    const minutes = schedule.everyMs / MINUTE_MS;
    if (Number.isInteger(minutes)) {
      return `Every ${minutes === 1 ? "minute" : `${minutes} minutes`}`;
    }
    return `Every ${Math.round(schedule.everyMs / 1000)} seconds`;
  }

  const weekdayCount = schedule.weekdays?.length ?? 0;
  const days =
    weekdayCount === 0
      ? "day"
      : weekdayCount === 5 && schedule.weekdays?.every((day) => day >= 1 && day <= 5)
        ? "weekday"
        : "selected day";
  return `At ${schedule.timeOfDay} every ${days}`;
}
