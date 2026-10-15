/**
 * What the Secrets page shows and asks, apart from how it draws (design artboard 18): the rows of
 * its table from what the Hub lists (the secrets stored, with what uses each, and the names
 * something refers to that nobody stored), when a value was stored, and the words of the deletion
 * that says what stops. Values never appear here: the Hub never returns one.
 */
import type { PeerSettingsPerson, PeerSettingsSecretsView } from "@t3tools/contracts";

export const SECRETS_DESCRIPTION =
  "Sealed on the Hub. Once saved, a value is never shown again; you can replace or delete it.";

/** What a secret that nothing refers to says in the "Used by" column. */
export const NOTHING_USES_IT = "Nothing uses it";

/**
 * The two secrets the Hub's Slack feature stores itself, and the use the table names for each. The
 * Hub lists what the settings name a secret for, and the settings name neither, so it says nothing
 * of them while Slack stops without them: a deletion would read "nothing stops". What the Hub does
 * say of one of them is told as it is.
 */
const SLACK_USES: Readonly<Record<string, string>> = {
  "slack-bot-token": "Slack · bot token",
  "slack-signing-secret": "Slack · signing secret",
};

/** The longest value the Hub seals. */
export const SECRET_VALUE_MAX = 8_192;

/** One row of the table: a stored secret, or a name that something uses and nobody stored. */
export interface SecretRow {
  readonly name: string;
  readonly stored: boolean;
  /** What uses it, one sentence each, as the Hub writes them; empty where nothing does. */
  readonly uses: ReadonlyArray<string>;
  /** "2 Oct": the day the value was stored; null where the Hub does not say, and for a missing one. */
  readonly when: string | null;
  /** Who stored it. */
  readonly by: string | null;
}

const compareNames = (a: SecretRow, b: SecretRow) => a.name.localeCompare(b.name);

const slackUse = (name: string): ReadonlyArray<string> => {
  const use = SLACK_USES[name];
  return use === undefined ? [] : [use];
};

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

/**
 * The table's rows: names that something refers to and nobody stored first, since they are what
 * needs doing; then the secrets something uses; then the ones nothing uses, which are only there
 * to be deleted. Each group by name.
 */
export function secretRows(
  view: PeerSettingsSecretsView,
  options: {
    readonly now?: Date;
    readonly timeZone?: string;
    readonly nameOf?: (person: PeerSettingsPerson) => string;
  } = {},
): ReadonlyArray<SecretRow> {
  const now = options.now ?? new Date();
  const stored: SecretRow[] = view.secrets.map((secret) => ({
    name: secret.name,
    stored: true,
    uses: secret.usedBy.length > 0 ? secret.usedBy : slackUse(secret.name),
    when: storedDate(secret.at, {
      now,
      ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    }),
    by:
      secret.by === null || secret.by === undefined
        ? null
        : (options.nameOf?.(secret.by) ?? secret.by.name),
  }));
  const names = new Set(stored.map((row) => row.name));
  const missing: SecretRow[] = view.missing
    .filter((entry) => !names.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      stored: false,
      uses: entry.usedBy,
      when: null,
      by: null,
    }));
  return [
    ...missing.toSorted(compareNames),
    ...stored.filter((row) => row.uses.length > 0).toSorted(compareNames),
    ...stored.filter((row) => row.uses.length === 0).toSorted(compareNames),
  ];
}

/** The "Used by" cell: what uses the secret, or that nothing does. */
export const usesOf = (row: Pick<SecretRow, "uses">): ReadonlyArray<string> =>
  row.uses.length === 0 ? [NOTHING_USES_IT] : row.uses;

/** The "Value" cell: where the value stands. Never the value. */
export function valueText(row: Pick<SecretRow, "stored" | "when">): string {
  if (!row.stored) return "Missing";
  return row.when === null ? "Stored" : `Stored · ${row.when}`;
}

/** Who stored the value, for the cell's tooltip. */
export const storedBy = (row: Pick<SecretRow, "by">): string | null =>
  row.by === null ? null : `Stored by ${row.by}`;

export const valueDialogTitle = (row: Pick<SecretRow, "name" | "stored">): string =>
  row.stored ? `Replace ${row.name}` : `Set ${row.name}`;

/** What saving a value does, in the dialog under its field. */
export const VALUE_DIALOG_NOTE = "Saved on the Hub and sealed. It is never shown again.";

/**
 * What stops when a secret something uses goes, in the words of the design: the sentence is
 * picked by what the Hub says uses it, and a use this build does not know of says the plain thing.
 */
export function impactOf(use: string, workspaceName: string): string {
  if (/^Shared capacity/i.test(use)) {
    return `Shared capacity turns off for all of ${workspaceName} until a new key is set.`;
  }
  if (/^GitHub/i.test(use)) return "GitHub’s deliveries will fail, so PR checks stop.";
  const webhook = /^Webhook [“"]([^”"]+)[”"]/.exec(use);
  if (webhook !== null) {
    const name = webhook[1] ?? "";
    return /signature|signing/i.test(use)
      ? `Webhook “${name}” pauses until it has a signing key again.`
      : `Webhook “${name}” stops delivering until its URL is set again.`;
  }
  if (/^Slack/i.test(use)) return "Slack stops until its tokens are stored again.";
  return `${use} stops working until the secret is set again.`;
}

export interface DeleteWords {
  readonly title: string;
  /** What uses the secret and what stops with it; empty where nothing uses it. */
  readonly impacts: ReadonlyArray<{ readonly use: string; readonly impact: string }>;
  /** The line for a secret nothing uses; null while something does. */
  readonly nothing: string | null;
  /** "Delete" for a secret nothing uses; "Delete anyway" while something does. */
  readonly confirm: string;
}

export function deleteWords(
  secret: { readonly name: string; readonly uses: ReadonlyArray<string> },
  workspaceName: string,
): DeleteWords {
  const used = secret.uses.length > 0;
  return {
    title: `Delete ${secret.name}?`,
    impacts: secret.uses.map((use) => ({ use, impact: impactOf(use, workspaceName) })),
    nothing: used ? null : "Nothing uses it, so nothing stops.",
    confirm: used ? "Delete anyway" : "Delete",
  };
}

/** What a successful save or deletion tells the person. */
export const storedMessage = (name: string): string => `Stored ${name}`;
export const deletedMessage = (name: string): string => `Deleted ${name}`;
