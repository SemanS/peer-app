/**
 * How the task page says when: "40 min ago" in a sentence, "40 min" in a column, a date once a
 * day has passed. Pure, with `now` passed in, so a label never depends on the clock it renders on.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const clock24 = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type When =
  | { readonly kind: "now" }
  | { readonly kind: "minutes"; readonly n: number }
  | { readonly kind: "hours"; readonly n: number }
  | { readonly kind: "yesterday" }
  | { readonly kind: "date"; readonly label: string };

/** Local calendar days between two instants, as people count them: yesterday is one. */
function calendarDays(from: Date, to: Date): number {
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Rounded, so a day of 23 or 25 hours across a clock change still counts as one.
  return Math.round((start(to).getTime() - start(from).getTime()) / DAY_MS);
}

function classify(at: string, now: number): When | null {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return null;
  const elapsed = now - time;
  // An instant ahead of this clock is as good as now.
  if (elapsed < MINUTE_MS) return { kind: "now" };
  if (elapsed < HOUR_MS) return { kind: "minutes", n: Math.floor(elapsed / MINUTE_MS) };
  if (elapsed < DAY_MS) return { kind: "hours", n: Math.floor(elapsed / HOUR_MS) };
  const then = new Date(time);
  const today = new Date(now);
  if (calendarDays(then, today) === 1) return { kind: "yesterday" };
  return {
    kind: "date",
    label: (then.getFullYear() === today.getFullYear() ? dayMonth : dayMonthYear).format(then),
  };
}

/** For a sentence: "just now", "40 min ago", "2 h ago", "yesterday", "on 10 Oct". */
export function agoLabel(at: string, now: number): string {
  const when = classify(at, now);
  if (when === null) return "";
  switch (when.kind) {
    case "now":
      return "just now";
    case "minutes":
      return `${when.n} min ago`;
    case "hours":
      return `${when.n} h ago`;
    case "yesterday":
      return "yesterday";
    case "date":
      return `on ${when.label}`;
  }
}

/** For a column: "Just now", "40 min", "2 h", "Yesterday", "10 Oct". */
export function shortWhen(at: string, now: number): string {
  const when = classify(at, now);
  if (when === null) return "";
  switch (when.kind) {
    case "now":
      return "Just now";
    case "minutes":
      return `${when.n} min`;
    case "hours":
      return `${when.n} h`;
    case "yesterday":
      return "Yesterday";
    case "date":
      return when.label;
  }
}

/** How long something has lasted, without "ago": "3 min", "2 h", "3 d"; null under a minute. */
export function lastedLabel(since: string, now: number): string | null {
  const time = Date.parse(since);
  if (!Number.isFinite(time)) return null;
  const elapsed = now - time;
  if (elapsed < MINUTE_MS) return null;
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h`;
  return `${Math.floor(elapsed / DAY_MS)} d`;
}

/** "10 Oct", with the year once it is not this one. */
export function dateLabel(at: string, now: number): string {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  return (date.getFullYear() === new Date(now).getFullYear() ? dayMonth : dayMonthYear).format(
    date,
  );
}

/** The time of day on a 24-hour clock; the page passes the person's own format instead. */
export function clockLabel(at: string): string {
  const time = Date.parse(at);
  return Number.isFinite(time) ? clock24.format(new Date(time)) : "";
}
