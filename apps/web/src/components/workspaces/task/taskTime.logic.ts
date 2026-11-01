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
