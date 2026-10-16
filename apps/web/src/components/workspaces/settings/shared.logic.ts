/**
 * What more than one page of the settings area needs, kept in one place so that no page's own logic
 * file is where another page's helper lives: how an amount of money is written, and what makes a
 * repository address and a branch safe for a computer to clone.
 */

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = { EUR: "€", USD: "$" };

/** The mark before an amount: `€` for EUR, `$` for USD, else the code and a space. */
export const currencySymbol = (currency: string): string =>
  CURRENCY_SYMBOLS[currency] ?? `${currency} `;

/** `€630`, `€12.50`, `$1,200`: whole amounts without decimals, others with two. */
export function formatMoney(amount: number, currency: string): string {
  const text = amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${currencySymbol(currency)}${text}`;
}

/** Characters that `git clone` would take for a space or a command's end, or that nobody types in an address. */
const UNFIT = /[\p{White_Space}\p{Cc}]/u;
const encoder = new TextEncoder();
const asciiLower = (text: string) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/**
 * Whether git may be told to clone `url` on a computer: plain https, http, ssh and git addresses,
 * `file:///`, scp-style `user@host:path` and absolute paths; never an option (a leading `-`) or a
 * `transport::address` helper (`ext::sh -c …` runs a command). This is the Hub's `safe_remote`
 * (`gitsafe.rs`), step for step, which Peer repeats before it clones: workspace admins write these
 * addresses, so it is the Hub that refuses an unsafe one, and this only keeps a form from offering it.
 */
export function isSafeGitRemote(url: string): boolean {
  const size = encoder.encode(url).length;
  if (size === 0 || size > 500 || url.startsWith("-") || url.includes("::") || UNFIT.test(url)) {
    return false;
  }
  const lower = asciiLower(url);
  for (const scheme of ["https://", "http://", "ssh://", "git://"]) {
    if (lower.startsWith(scheme)) {
      const rest = lower.slice(scheme.length);
      return rest !== "" && !rest.startsWith("/");
    }
  }
  if (lower.startsWith("file:///") || url.startsWith("/")) return true;
  // scp-style: [user@]host:path
  const colon = url.indexOf(":");
  if (colon < 0) return false;
  const authority = url.slice(0, colon);
  const path = url.slice(colon + 1);
  const at = authority.lastIndexOf("@");
  if (at >= 0) {
    const user = authority.slice(0, at);
    if (!/^[A-Za-z0-9._-]+$/.test(user)) return false;
  }
  const host = at < 0 ? authority : authority.slice(at + 1);
  return (
    /^[A-Za-z0-9.-]+$/.test(host) && path !== "" && !/^[/\\]/.test(path) && !path.includes(":")
  );
}

/**
 * Whether `ref` is a branch name rather than an option, as the Hub's `safe_ref` decides: plain
 * characters, not starting with `-` or `/`, not ending with `/` or `.lock`, no `..` and no `//`.
 */
export function isSafeGitRef(ref: string): boolean {
  return (
    /^[A-Za-z0-9._/-]{1,200}$/.test(ref) &&
    !/^[-/]/.test(ref) &&
    !ref.endsWith("/") &&
    !ref.endsWith(".lock") &&
    !ref.includes("..") &&
    !ref.includes("//")
  );
}
