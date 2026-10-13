/**
 * The small words the ownership screens share: how long something has waited, and a person's
 * initial. Pure, so the sheet, the card and the Team section say the same thing the same way.
 */

/** "1 task", "3 tasks". */
export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * How long a wait has lasted, as the Team page words it: "now", "40 min", "3 h", "1 day", "6 days".
 * A time in the future (a clock a little behind the Hub's) counts as now.
 */
export function spanWords(ms: number): string {
  const minutes = Math.floor((Number.isFinite(ms) ? Math.max(0, ms) : 0) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/** How long ago something began: "40 min ago", "just now". */
export function agoWords(ms: number): string {
  const span = spanWords(ms);
  return span === "now" ? "just now" : `${span} ago`;
}

/** How long a call has left: "expires in 6 days". */
export function expiresWords(ms: number): string {
  return ms < 60_000 ? "expires within a minute" : `expires in ${spanWords(ms)}`;
}

/** The first letter of a name, in capitals, for a person's mark. */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}
