/**
 * Small rules behind signing in to a Peer Hub and creating a workspace. The
 * hub enforces all of them; these only shape what the form offers.
 */

/** Mail providers anyone can sign up at; their domain never admits a whole workspace. */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "web.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
  "fastmail.com",
  "tutanota.com",
  "hey.com",
  "seznam.cz",
  "email.cz",
  "centrum.cz",
  "atlas.cz",
  "centrum.sk",
  "azet.sk",
  "zoznam.sk",
  "post.sk",
  "pobox.sk",
  "atlas.sk",
  "wp.pl",
  "o2.pl",
  "onet.pl",
  "interia.pl",
]);

/** The domain a new workspace may admit by address, or null for a personal mail provider. */
export function companyDomainOf(email: string | null): string | null {
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  if (!domain || !domain.includes(".")) return null;
  return PUBLIC_EMAIL_DOMAINS.has(domain) ? null : domain;
}

/** A workspace URL name from its display name: lowercase kebab-case, at most 40 characters. */
export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidWorkspaceSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length >= 2 && slug.length <= 40;
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Labels under a country code that a company name sits beneath, as in acme.co.uk. */
const SECOND_LEVEL_LABELS = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/** A workspace name from a company's mail domain: "webinson.com" → "Webinson", "acme-labs.co.uk" → "Acme Labs". */
export function workspaceNameFromDomain(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  let index = labels.length - 2;
  const last = labels[labels.length - 1] ?? "";
  if (index > 0 && last.length === 2 && SECOND_LEVEL_LABELS.has(labels[index] ?? "")) index -= 1;
  const label = labels[Math.max(index, 0)] ?? domain;
  return label
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

interface WorkspaceRef {
  readonly slug: string;
  readonly name: string;
  readonly allowedDomains: ReadonlyArray<string>;
}

/** Whether a workspace this person is in, or may join, already admits their domain. */
export function domainHasWorkspace(
  status: {
    readonly workspaces: ReadonlyArray<WorkspaceRef>;
    readonly joinable: ReadonlyArray<WorkspaceRef>;
    readonly domainOffers?: ReadonlyArray<{ readonly domain: string }> | undefined;
  },
  domain: string,
): boolean {
  return (
    (status.domainOffers ?? []).some((offer) => offer.domain === domain) ||
    [...status.workspaces, ...status.joinable].some((workspace) =>
      workspace.allowedDomains.includes(domain),
    )
  );
}

export const openToDomainByDefault = (
  status: Parameters<typeof domainHasWorkspace>[0],
  domain: string,
) => !domainHasWorkspace(status, domain);

export function matchesWorkspaceQuery(
  workspace: Pick<WorkspaceRef, "slug" | "name">,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === "" ||
    workspace.slug.includes(needle) ||
    workspace.name.toLowerCase().includes(needle)
  );
}

/** The id of General's Email domains section, which links scroll to. */
export const EMAIL_DOMAINS_TARGET = "email-domains";

/**
 * What the picker proposes for the person's company domain: creating the domain's workspace, adding
 * the domain to a workspace they own that lists none, or nothing. Nothing while an organization
 * founded for them waits (that offer is the only proposal), and nothing more for someone who
 * already runs a workspace, since the domain then belongs in that one or nowhere.
 */
export type DomainProposal =
  | { readonly kind: "create"; readonly domain: string; readonly name: string }
  | {
      readonly kind: "add";
      readonly domain: string;
      readonly workspace: { readonly slug: string; readonly name: string };
    };

export function domainProposal(status: {
  readonly email: string | null;
  readonly workspaces: ReadonlyArray<WorkspaceRef & { readonly role: string }>;
  readonly joinable: ReadonlyArray<WorkspaceRef>;
  readonly domainOffers?: ReadonlyArray<{ readonly domain: string }> | undefined;
  readonly foundings?: ReadonlyArray<unknown> | undefined;
}): DomainProposal | null {
  const domain = companyDomainOf(status.email);
  if (domain === null || domainHasWorkspace(status, domain)) return null;
  if ((status.foundings ?? []).length > 0) return null;
  // Only owners change which domains join on their own.
  const bare = status.workspaces.find(
    (workspace) => workspace.role === "owner" && workspace.allowedDomains.length === 0,
  );
  if (bare !== undefined) {
    return { kind: "add", domain, workspace: { slug: bare.slug, name: bare.name } };
  }
  if (status.workspaces.some((workspace) => workspace.role !== "member")) return null;
  return { kind: "create", domain, name: workspaceNameFromDomain(domain) };
}
