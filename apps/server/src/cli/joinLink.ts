/**
 * An invitation link as the Hub mails it, `{public_url}/join/{slug}?email=…`, read into the Hub it
 * came from, the workspace and the invited address. `peer core join` takes it as well as a slug.
 *
 * @module cli/joinLink
 */
import * as Result from "effect/Result";

export interface JoinLink {
  /** The Hub's address: everything before `/join/`, without a trailing slash. */
  readonly hub: string;
  readonly slug: string;
  readonly email: string;
}

/** Whether `peer core join`'s argument is a link rather than a slug. */
export const isJoinLink = (text: string) => /^https?:\/\//i.test(text.trim());

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A development Hub on this computer, the only one a link may name over plain `http:`. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const isLoopback = (url: URL) => LOOPBACK.has(url.hostname.toLowerCase());

const originAndPath = (url: URL) => `${url.origin}${url.pathname.replace(/\/+$/, "")}`;

/**
 * The link's Hub, workspace and address, or why it is not an invitation link. With `hubUrl` (the
 * Hub this computer signs in to, or `--hub`), a link of another Hub is refused.
 */
export function parseJoinLink(text: string, hubUrl?: string): Result.Result<JoinLink, string> {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return Result.fail(`${text} is not a link.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return Result.fail(`${text} is not an invitation link (https://…/join/<workspace>?email=…).`);
  // A sign-in code over plain HTTP could be read on the way; only a Hub on this computer may ask.
  if (url.protocol === "http:" && !isLoopback(url))
    return Result.fail(`${text} is not https; Peer signs in to a Hub over https only.`);
  const match = /^(.*)\/join\/([^/]+)\/?$/.exec(url.pathname);
  if (match === null)
    return Result.fail(`${text} is not an invitation link (https://…/join/<workspace>?email=…).`);
  const slug = decodeURIComponent(match[2] ?? "").toLowerCase();
  if (!SLUG.test(slug)) return Result.fail(`${text} names no workspace Peer can use.`);
  const email = url.searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!/^[^@\s]+@[^@\s]+$/.test(email))
    return Result.fail(`${text} names no address; open the link from the invitation email.`);
  const hub = `${url.origin}${(match[1] ?? "").replace(/\/+$/, "")}`;
  if (hubUrl !== undefined && hubUrl.trim() !== "") {
    let expected: string;
    try {
      expected = originAndPath(new URL(hubUrl.trim()));
    } catch {
      return Result.fail(`${hubUrl} is not a Hub address.`);
    }
    if (expected.toLowerCase() !== hub.toLowerCase())
      return Result.fail(`The link is for the Hub at ${hub}, not ${expected}.`);
  }
  return Result.succeed({ hub, slug, email });
}
