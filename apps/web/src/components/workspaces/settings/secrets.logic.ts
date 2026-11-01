/**
 * What the Secrets page shows and asks, apart from how it draws (design artboard 18): the rows of
 * its table from what the Hub lists and when a value was stored. Values never appear here: the Hub
 * never returns one.
 */
import type { PeerSettingsPerson, PeerSettingsSecretsView } from "@t3tools/contracts";

export const SECRETS_DESCRIPTION =
  "Sealed on the Hub. Once saved, a value is never shown again; you can replace or delete it.";

/** The longest value the Hub seals. */
export const SECRET_VALUE_MAX = 8_192;

/** One row of the table: a stored secret. */
export interface SecretRow {
  readonly name: string;
  /** "2 Oct": the day the value was stored; null where the Hub does not say. */
  readonly when: string | null;
  /** Who stored it. */
  readonly by: string | null;
}

/**
 * "2 Oct", and "2 Oct 2025" for another year than `now`'s, in English whatever the host's locale
 * (the page's words are English). Null for no time, or one that is not a time.
 */
export function storedDate(
  at: string | null | undefined,
  options: { readonly now: Date; readonly timeZone?: string },
): string | null {
  if (at === null || at === undefined) return null;
  const time = Date.parse(at);
  if (Number.isNaN(time)) return null;
  const format = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
  });
  const parts = (date: Date) => {
    const found = format.formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPartTypes) =>
      found.find((part) => part.type === type)?.value ?? "";
    return { day: pick("day"), month: pick("month"), year: pick("year") };
  };
  const stored = parts(new Date(time));
  const sameYear = stored.year === parts(options.now).year;
  return sameYear
    ? `${stored.day} ${stored.month}`
    : `${stored.day} ${stored.month} ${stored.year}`;
}

/** The table's rows, by name. */
export function secretRows(
  view: PeerSettingsSecretsView,
  options: {
    readonly now?: Date;
    readonly timeZone?: string;
    readonly nameOf?: (person: PeerSettingsPerson) => string;
  } = {},
): ReadonlyArray<SecretRow> {
  const now = options.now ?? new Date();
  const rows: SecretRow[] = view.secrets.map((secret) => ({
    name: secret.name,
    when: storedDate(secret.at, {
      now,
      ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    }),
    by:
      secret.by === null || secret.by === undefined
        ? null
        : (options.nameOf?.(secret.by) ?? secret.by.name),
  }));
  return rows.toSorted((a, b) => a.name.localeCompare(b.name));
}

/** The "Value" cell: where the value stands. Never the value. */
export const valueText = (row: Pick<SecretRow, "when">): string =>
  row.when === null ? "Stored" : `Stored · ${row.when}`;

/** Who stored the value, for the cell's tooltip. */
export const storedBy = (row: Pick<SecretRow, "by">): string | null =>
  row.by === null ? null : `Stored by ${row.by}`;

/** What saving a value does, in the dialog under its field. */
export const VALUE_DIALOG_NOTE = "Saved on the Hub and sealed. It is never shown again.";

/** What a successful save or deletion tells the person. */
export const storedMessage = (name: string): string => `Stored ${name}`;
export const deletedMessage = (name: string): string => `Deleted ${name}`;
