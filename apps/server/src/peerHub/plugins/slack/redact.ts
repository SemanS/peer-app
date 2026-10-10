/**
 * redact — what of an agent's text may leave this computer for Slack.
 *
 * Slack carries an agent's words into a channel, so they are cleaned first: free of control and
 * directional characters, free of what looks like a credential, and bounded. The Hub escapes `&`,
 * `<` and `>` and cuts again, so nothing here escapes; this is the line of defence on the computer
 * the credentials are on. A pattern errs towards `[redacted]`: a false match costs a word, a miss
 * costs a key.
 *
 * Only the start of a text is read (the bound plus a margin for a match that ends past it), so
 * no pattern is quadratic in the text however long an agent's message is.
 *
 * @module peerHub/plugins/slack/redact
 */

/** A question or last message, in characters. */
export const SLACK_TEXT_MAX = 2_800;
/** A title, in characters. */
const TITLE_MAX = 120;

const REDACTED = "[redacted]";
/** Ends a text that was cut; it counts within the bound. */
const REST = "… the rest is in Peer";
/** How far past the bound a text is read, so a key that starts before the cut ends inside the read. */
const MARGIN = 4_096;

/**
 * Control characters but newline and tab, and the marks that reorder or hide text: directional
 * controls, zero-width space, word joiner, byte order mark.
 */
const HIDDEN =
  // eslint-disable-next-line no-control-regex -- the control characters are what it matches.
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;

/** What looks like a credential, in the order it is replaced. */
const SECRETS: ReadonlyArray<readonly [RegExp, string]> = [
  // A private key whole; one cut short goes to the end of the text.
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
    REDACTED,
  ],
  // GitHub tokens, classic and fine-grained.
  [/gh[pousr]_[A-Za-z0-9]{36,}/g, REDACTED],
  [/github_pat_\w{22,}/g, REDACTED],
  // Slack bot, user, app-level and configuration tokens.
  [/xox[abeprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/xapp-[A-Za-z0-9-]{10,}/g, REDACTED],
  // `sk-` API keys (OpenAI, Anthropic's `sk-ant-`); not the end of a word like `task-`.
  [/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/g, REDACTED],
  // AWS access key ids, long-lived and temporary.
  [/(?<![A-Z0-9])A[KS]IA[0-9A-Z]{16}/g, REDACTED],
  // JSON web tokens, from where one starts (so a run of `eyJ` is one match, not many).
  [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, REDACTED],
  // Peer's own: a session (`phs_`) and an announcement credential (`pan_`).
  [/(?<![A-Za-z0-9])(?:phs|pan)_[A-Za-z0-9_-]{16,}/g, REDACTED],
  // `Authorization: Bearer <token>`: the scheme stays.
  [/\b(Bearer[ \t]+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1${REDACTED}`],
  // The password in `scheme://user:password@host`.
  [/(\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s:@/]+:)[^\s@/]+(?=@)/gi, `$1${REDACTED}`],
  // `password = value`, `"api_key": "value"`, `DB_PASSWORD=value`, `AWS_SECRET_ACCESS_KEY=value`:
  // the name stays, its value goes, a quoted one whole and any other up to white space. A value
  // an earlier pattern replaced is left, so `x-access-token:[redacted]@host` keeps its host.
  [
    /((?:password|passwd|secret|token|api[_-]?key)(?:[_-]?(?:access[_-]?)?key)?["']?[ \t]*[:=][ \t]*)(?!\[redacted\])(?:"[^"\n]*"|'[^'\n]*'|\S+)/gi,
    `$1${REDACTED}`,
  ],
];

const redact = (text: string) =>
  SECRETS.reduce((clean, [pattern, replacement]) => clean.replace(pattern, replacement), text);

/** `text` cut to at most `max` UTF-16 units, never between the two halves of one character. */
function cutAt(text: string, max: number): string {
  const end = Math.max(0, max);
  if (text.length <= end) return text;
  const last = text.charCodeAt(end - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

/**
 * A question or an agent's message as Slack may carry it: control characters out (newline and tab
 * stay), credentials replaced by `[redacted]`, and cut to `max` characters, the end of a cut text
 * saying where the rest is. The cut never splits a surrogate pair.
 */
export function cleanForSlack(text: string, max = SLACK_TEXT_MAX): string {
  const read = cutAt(text, max + MARGIN);
  const clean = redact(read.replace(HIDDEN, ""));
  if (clean.length <= max && read.length === text.length) return clean;
  return `${cutAt(clean, max - REST.length)}${REST}`.slice(0, max);
}

/**
 * A title on one line: control characters out, credentials replaced by `[redacted]`, white space
 * collapsed, and cut to `max` characters with an ellipsis. Empty when nothing is left.
 */
export function titleForSlack(text: string, max = TITLE_MAX): string {
  const line = redact(cutAt(text, max + MARGIN).replace(HIDDEN, ""))
    .replace(/\s+/g, " ")
    .trim();
  return line.length <= max ? line : `${cutAt(line, max - 1).trimEnd()}…`;
}
