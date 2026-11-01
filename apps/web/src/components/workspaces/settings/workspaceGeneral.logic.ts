/**
 * What the workspace's General page works out, apart from how it draws (design artboard 14): whether
 * a name can be saved, the state each email domain is in and what the page says of it, what the
 * Hub's answers to adding and checking a domain mean in words. The Hub decides every change again
 * (an owner changes domains, an admin the rest); these only keep the page from offering what it
 * would refuse.
 */
import type { PeerDomainState, PeerSettingsDomainCheck } from "@t3tools/contracts";

import { companyDomainOf } from "../workspaceAccess.logic";

/** The longest name the Hub keeps; it cuts a longer one. */
export const NAME_MAX = 80;

export type NameCheck =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly problem: string | null };

/**
 * Whether what is typed can be saved as the workspace's name: not blank, not cut by the Hub, and not
 * what it is already. No problem is said of an unchanged name.
 */
export function checkName(typed: string, current: string): NameCheck {
  const name = typed.trim();
  if (name === "") return { ok: false, problem: "A workspace needs a name." };
  if (Array.from(name).length > NAME_MAX) {
    return { ok: false, problem: `A name is at most ${NAME_MAX} characters.` };
  }
  return name === current.trim() ? { ok: false, problem: null } : { ok: true, name };
}

export const DOMAIN_LABELS: Readonly<Record<PeerDomainState, string>> = {
  verified: "Verified",
  claimed: "Claimed",
  listed: "Listed",
};

/** What a domain's state means for the people with an address there (design artboard 14). */
export function domainNote(state: PeerDomainState | undefined, workspace: string): string {
  switch (state) {
    case "verified":
      return `Proved with DNS. Colleagues with this address join ${workspace} on their own.`;
    case "claimed":
      return `${workspace} listed it first, so colleagues join on their own. Verify to keep it for sure.`;
    case "listed":
      return "Another workspace holds it. People here get an offer to join, not a seat.";
    case undefined:
      return `Colleagues with this address join ${workspace} on their own.`;
  }
}

/** One domain the workspace lists. */
export interface DomainRow {
  readonly domain: string;
  /** Undefined where the Hub does not say (one from before domain claims). */
  readonly state: PeerDomainState | undefined;
  readonly note: string;
  /** A domain that is not proved yet can be: the row offers "Verify with DNS". */
  readonly canVerify: boolean;
}

/**
 * The domains in the order the Hub lists them. A check made on this page says what the domain is
 * now before the next sync does, so `checked` stands in for the status until it catches up.
 */
export function domainRows(input: {
  readonly workspace: string;
  readonly domains: ReadonlyArray<string>;
  readonly claims:
    | ReadonlyArray<{ readonly domain: string; readonly state: PeerDomainState }>
    | undefined;
  readonly checked: Readonly<Record<string, PeerDomainState | undefined>>;
}): ReadonlyArray<DomainRow> {
  return input.domains.map((domain) => {
    const state =
      (Object.hasOwn(input.checked, domain) ? input.checked[domain] : undefined) ??
      input.claims?.find((claim) => claim.domain === domain)?.state;
    return {
      domain,
      state,
      note: domainNote(state, input.workspace),
      canVerify: state === "claimed" || state === "listed",
    };
  });
}

/** What the Hub would refuse in a domain, as the Hub's own check reads one (`valid_domain`). */
function isDomain(domain: string): boolean {
  return (
    domain.length <= 253 &&
    domain.includes(".") &&
    domain
      .split(".")
      .every(
        (label) =>
          /^[a-z0-9-]{1,63}$/.test(label) && !label.startsWith("-") && !label.endsWith("-"),
      )
  );
}

export type DomainInput =
  | { readonly ok: true; readonly domain: string }
  | { readonly ok: false; readonly problem: string | null };

/**
 * Whether what is typed can be added: a domain (an address pasted in gives its domain), not a public
 * mail provider's, not listed yet, and the person's own, since only someone with an address in a
 * domain opens the workspace to it. Nothing is said of an empty field.
 */
export function checkNewDomain(
  typed: string,
  context: { readonly listed: ReadonlyArray<string>; readonly mine: string | null },
): DomainInput {
  const raw = typed.trim().toLowerCase();
  const domain = (raw.includes("@") ? raw.slice(raw.lastIndexOf("@") + 1) : raw).replace(/^@/, "");
  if (domain === "") return { ok: false, problem: null };
  if (!isDomain(domain)) {
    return { ok: false, problem: "That is not a domain. Write it like acme.com." };
  }
  // The domain is well formed, so a miss here is a provider anyone can sign up at.
  if (companyDomainOf(`someone@${domain}`) === null) {
    return { ok: false, problem: "Public mail domains like gmail.com can’t be added." };
  }
  if (context.listed.includes(domain)) {
    return { ok: false, problem: `${domain} is listed already.` };
  }
  if (context.mine !== null && context.mine !== domain) {
    return {
      ok: false,
      problem: `Add a domain you have an address at. Yours is ${context.mine}.`,
    };
  }
  return { ok: true, domain };
}

/** The domain of an address, lower case; null for something that is not one. */
export function mailDomainOf(email: string | null): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  return email === null || at < 0 ? null : email.slice(at + 1).toLowerCase();
}

export const withDomain = (domains: ReadonlyArray<string>, domain: string): string[] =>
  domains.includes(domain) ? [...domains] : [...domains, domain];

export const withoutDomain = (domains: ReadonlyArray<string>, domain: string): string[] =>
  domains.filter((listed) => listed !== domain);

/** What taking a domain away does, said before the person confirms. */
export function removeDomainWords(
  row: Pick<DomainRow, "domain" | "state">,
  workspace: string,
): string {
  const lose = `People with an address at ${row.domain} stop joining ${workspace} on their own. Whoever is in it stays.`;
  return row.state === "verified"
    ? `Remove ${row.domain}? ${lose} Its DNS proof is let go; to take it back later you prove it again.`
    : `Remove ${row.domain}? ${lose}`;
}

export type CheckTone = "idle" | "ok" | "wait" | "error";

/** What a check says, with the tone its dot is drawn in. */
export interface CheckOutcome {
  readonly tone: CheckTone;
  readonly text: string;
}

export const NOT_CHECKED: CheckOutcome = { tone: "idle", text: "Not checked yet" };

const NO_RECORD =
  "We don’t see the record yet. DNS can take up to an hour; the value stays the same.";

/** What DNS said (`dns` of the Hub's answers): the record, none, no answer, or the Hub does not look. */
function dnsOutcome(dns: string | undefined, domain: string): CheckOutcome | null {
  switch (dns) {
    case "missing":
      return { tone: "wait", text: NO_RECORD };
    case "unavailable":
      return {
        tone: "wait",
        text: "DNS can’t be read right now, so nothing was checked. Try again in a few minutes.",
      };
    case "off":
      return {
        tone: "wait",
        text: `This Hub doesn’t check DNS, so a record can’t verify ${domain}. Ask the Hub’s operator to settle it.`,
      };
    default:
      return null;
  }
}

/**
 * What the Hub found when asked to check a domain: the record is there and the domain is the
 * workspace's now (taken over from the workspace that held it, if it was listed), it is not there
 * yet (which also ends an earlier verification), or DNS could not be read, or the Hub does not look.
 */
export function checkOutcome(
  check: PeerSettingsDomainCheck,
  context: {
    readonly workspace: string;
    /** What the domain was before the check. */
    readonly before: PeerDomainState | undefined;
    /** Who held it, where the person has been told. */
    readonly holder?: string | undefined;
  },
): CheckOutcome {
  const { domain } = check;
  if (check.dns === "found" && check.state === "verified") {
    return {
      tone: "ok",
      text:
        context.before === "listed"
          ? `Verified. ${domain} now belongs to ${context.workspace}, taken over from ${context.holder ?? "another workspace"}.`
          : `Verified. ${domain} is proved with DNS and stays with ${context.workspace}.`,
    };
  }
  if (check.dns === "missing" && context.before === "verified") {
    return {
      tone: "wait",
      text: `We don’t see the record any more, so ${domain} is not verified now. Add it again to prove it.`,
    };
  }
  return (
    dnsOutcome(check.dns, domain) ?? {
      tone: "wait",
      text: `The Hub could not check ${domain} just now. Try again in a few minutes.`,
    }
  );
}

/** What the Hub refused an added domain for: another workspace holds it, and the record that would take it over. */
export interface DomainClaim {
  readonly domain: string;
  readonly record: string;
  readonly holder?:
    | { readonly slug: string; readonly name: string; readonly verified: boolean }
    | undefined;
  /** What DNS said when the Hub looked for the record. */
  readonly dns?: string | undefined;
}

/** The line under a domain the Hub did not take. */
export function claimNote(claim: DomainClaim): string {
  const holder = claim.holder?.name ?? "Another workspace";
  return claim.holder?.verified === true
    ? `${holder} holds it and proved it with DNS, so it can’t be taken over.`
    : `${holder} holds it. Prove you control ${claim.domain} to add it.`;
}

/** What a try at adding a refused domain again found. */
export function claimOutcome(claim: DomainClaim): CheckOutcome {
  const holder = claim.holder?.name ?? "Another workspace";
  if (claim.holder?.verified === true) {
    return {
      tone: "wait",
      text: `${holder} proved ${claim.domain} with DNS, so a record can’t take it over. Ask its owners to release it.`,
    };
  }
  return (
    dnsOutcome(claim.dns, claim.domain) ?? {
      tone: "idle",
      text: `${holder} holds ${claim.domain}. Publish the record, then check.`,
    }
  );
}

/** Where the workspace's configuration stands: the settings revision, and the Hub's id for what is applied. */
export function configurationText(revision: number | null, applied: string | undefined): string {
  const parts = [
    revision === null ? null : `Revision ${revision}`,
    applied === undefined ? null : `applied ${applied}`,
  ].filter((part) => part !== null);
  return parts.length === 0 ? "Nothing applied yet" : parts.join(" · ");
}
