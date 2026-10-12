/**
 * What the scheduled-task form says about time: the zones it offers, a zone in words, the choices
 * for a run the computer slept through, and when the next runs are. The runs come from the same
 * `nextFixedTimeRun` the server schedules with, so the form cannot promise a time the scheduler
 * will not keep.
 */
import { nextFixedTimeRun } from "@t3tools/shared/scheduledTaskRuns";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** How long after the scheduled time a run may still catch up, as the form offers it. */
const CATCH_UP_CHOICES_MS = [2 * HOUR_MS, 6 * HOUR_MS, 12 * HOUR_MS];
export const DEFAULT_CATCH_UP_MS = 6 * HOUR_MS;

/** The windows to offer: the usual ones, and a saved window of another length so it stays visible. */
export function catchUpChoices(currentMs: number): ReadonlyArray<number> {
  return [...new Set<number>([...CATCH_UP_CHOICES_MS, currentMs])].toSorted((a, b) => a - b);
}

/** A window in words: "1 hour", "6 hours", "90 minutes". */
export function windowLabel(ms: number): string {
  if (ms % HOUR_MS === 0) return ms === HOUR_MS ? "1 hour" : `${ms / HOUR_MS} hours`;
  const minutes = Math.round(ms / MINUTE_MS);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

// ---- zones in words -------------------------------------------------------------------------------

function zonePart(
  locale: string,
  zone: string,
  at: number,
  options: Intl.DateTimeFormatOptions,
  type: Intl.DateTimeFormatPartTypes,
): string | undefined {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: zone, ...options })
      .formatToParts(at)
      .find((part) => part.type === type)?.value;
  } catch {
    return undefined;
  }
}

/** The zone's offset from UTC at an instant, in minutes; null for a zone this browser does not know. */
export function zoneOffsetMinutes(zone: string, at: number): number | null {
  const text = zonePart("en-US", zone, at, { timeZoneName: "longOffset" }, "timeZoneName");
  if (text === undefined) return null;
  const match = /^GMT(?:([+\-−])(\d{1,2})(?::(\d{2}))?)?$/.exec(text);
  if (match === null) return null;
  if (match[1] === undefined) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "+" ? minutes : -minutes;
}

/** "UTC+2", "UTC+5:30", "UTC−4" (a true minus), "UTC" for none. */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes < 0 ? "−" : "+";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `UTC${sign}${hours}${rest === 0 ? "" : `:${String(rest).padStart(2, "0")}`}`;
}

/**
 * The zone's short name at an instant: "CEST", "BST", "EDT". The locales know them for their own
 * part of the world, so both are asked; a zone with no short name of its own is given by offset.
 */
export function zoneAbbreviation(zone: string, at: number): string {
  for (const locale of ["en-GB", "en-US"]) {
    const name = zonePart(locale, zone, at, { timeZoneName: "short" }, "timeZoneName");
    if (name !== undefined && /^[A-Z]{2,5}$/.test(name)) return name;
  }
  const minutes = zoneOffsetMinutes(zone, at);
  return minutes === null ? zone : offsetLabel(minutes);
}

/** A zone as the select lists it: "Europe/Bratislava · CEST, UTC+2". */
export function zoneLabel(zone: string, at: number): string {
  const minutes = zoneOffsetMinutes(zone, at);
  if (minutes === null || zone === "UTC") return zone;
  const short = zoneAbbreviation(zone, at);
  const offset = offsetLabel(minutes);
  return short === offset ? `${zone} · ${offset}` : `${zone} · ${short}, ${offset}`;
}

/** A zone with its offset alone, cheap enough to give every zone of a long list: "Asia/Tokyo · UTC+9". */
export function zoneOffsetLabel(zone: string, at: number): string {
  const minutes = zoneOffsetMinutes(zone, at);
  return minutes === null || zone === "UTC" ? zone : `${zone} · ${offsetLabel(minutes)}`;
}

const COMMON_ZONES = [
  "Europe/London",
  "Europe/Berlin",
  "Europe/Bratislava",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
];

/**
 * The zones to offer, after the computer's own: UTC, then every zone this browser knows by name
 * (a short list where it cannot say), and the task's saved zone if it is not among them.
 */
export function zoneNames(saved: string, known?: ReadonlyArray<string>): ReadonlyArray<string> {
  const names =
    known ??
    (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []);
  const all = names.length > 0 ? names : COMMON_ZONES;
  return [...new Set<string>(["UTC", ...(saved === "" ? [] : [saved]), ...all])];
}

/** "Bratislava", "New York": the zone's city, for a sentence. */
function cityOf(zone: string): string {
  return (zone.split("/").at(-1) ?? zone).replaceAll("_", " ");
}

/** Whether the zone changes its clocks for summer time: its January and July offsets differ. */
function observesSummerTime(zone: string, now: number): boolean {
  const year = new Date(now).getUTCFullYear();
  const january = zoneOffsetMinutes(zone, Date.UTC(year, 0, 1));
  const july = zoneOffsetMinutes(zone, Date.UTC(year, 6, 1));
  return january !== null && july !== null && january !== july;
}

// ---- when it runs next ----------------------------------------------------------------------------

/** "Tue 13 Oct" in the zone. */
function dayLabel(at: number, zone: string): string {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    zonePart("en-GB", zone, at, { weekday: "short", day: "numeric", month: "short" }, type) ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

/** "09:00" in the zone. */
function clockLabel(at: number, zone: string): string {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    zonePart("en-GB", zone, at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, type) ??
    "";
  return `${part("hour")}:${part("minute")}`;
}

/** How long until a run, rounded the way people say it: "in 17 h", "in 3 days". */
export function untilLabel(ms: number): string {
  if (ms < MINUTE_MS) return "in under a minute";
  if (ms < HOUR_MS) return `in ${Math.round(ms / MINUTE_MS)} min`;
  const hours = Math.round(ms / HOUR_MS);
  return hours > 36 ? `in ${Math.round(hours / 24)} days` : `in ${hours} h`;
}

export interface NextRunPreview {
  /** "Tue 13 Oct, 09:00 CEST — in 17 h" */
  readonly next: string;
  /** "Then Wed 14 Oct, Thu 15 Oct …" */
  readonly following: string;
  /** What the zone does to the time of day when its clocks change. */
  readonly note: string;
}

/**
 * The next runs of a fixed-time schedule, in the zone it runs in. Null while the time is not one
 * (an empty field), or the zone is not one this browser knows, since a time in a guessed zone
 * would be a promise nobody keeps.
 */
export function nextRunPreview(input: {
  readonly timeOfDay: string;
  readonly weekdays: ReadonlySet<number>;
  /** The IANA name the schedule runs in (the computer's, when the task names none). */
  readonly zone: string;
  readonly now: number;
}): NextRunPreview | null {
  const { zone, now } = input;
  if (Option.isNone(DateTime.zoneMakeNamed(zone))) return null;
  const everyDay = input.weekdays.size === 0 || input.weekdays.size === 7;
  const schedule = {
    type: "fixed_time",
    timeOfDay: input.timeOfDay,
    ...(everyDay ? {} : { weekdays: [...input.weekdays].toSorted((a, b) => a - b) }),
    timeZone: zone,
  } as const;
  const runs: number[] = [];
  let from: DateTime.DateTime = DateTime.makeUnsafe(now);
  for (let count = 0; count < 3; count += 1) {
    const next = nextFixedTimeRun(schedule, from);
    if (next === null) break;
    runs.push(DateTime.toEpochMillis(next));
    from = next;
  }
  const [first, ...later] = runs;
  if (first === undefined) return null;
  const city = cityOf(zone);
  return {
    next: `${dayLabel(first, zone)}, ${clockLabel(first, zone)} ${zoneAbbreviation(zone, first)} — ${untilLabel(first - now)}`,
    following: `Then ${later.map((at) => dayLabel(at, zone)).join(", ")} …`,
    note: observesSummerTime(zone, now)
      ? `Follows ${city} time: it stays at ${clockLabel(first, zone)} there when the clocks change.`
      : zone === "UTC"
        ? "UTC never changes for summer time."
        : `${city} has no summer time, so this never shifts.`,
  };
}
