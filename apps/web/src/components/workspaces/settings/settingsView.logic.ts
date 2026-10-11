/**
 * What a workspace's settings view says about the person reading it: whether they may change a
 * node of the document, who may when they may not, and how a person is named. The Hub decides every
 * change (its owner table is design H3 step 3); these only let a page enable the controls the Hub
 * would accept and name the owners of the rest.
 */
import { getAt } from "@t3tools/client-runtime/peer-settings";
import type { PeerHubStatus, PeerSettingsRights } from "@t3tools/contracts";

type Path = ReadonlyArray<string>;

/** The settings document as the Hub shows the caller: its visible part, an open JSON object. */
export type SettingsDocument = Readonly<Record<string, unknown>>;

/** What the view knows of a person: an address, and how to call them. */
export interface SettingsPerson {
  readonly email: string;
  readonly name: string;
}

export interface SettingsRightsInput {
  readonly rights: PeerSettingsRights;
  /** The signed-in address. */
  readonly email: string | null;
  readonly document: SettingsDocument;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The shared capacity of a project that only admins change: its budget, pool, models and use, or all of it. */
const ADMIN_SHARED_FIELDS: ReadonlySet<string> = new Set(["budget", "pool", "models", "use"]);

/** A node under a project that belongs to admins alone: `capacity.shared` itself, or one of its fields. */
function isAdminShared(below: Path): boolean {
  if (below[0] !== "capacity" || below[1] !== "shared") return false;
  const field = below[2];
  return field === undefined || ADMIN_SHARED_FIELDS.has(field);
}

/**
 * Whether the caller may change the node at `path`, by the Hub's table: admins anything; a project's
 * leads the project's nodes but not its shared budget, pool, models or use; a project anyone may
 * create (whoever it names as lead is the Hub's concern) and only its leads delete; a person their
 * own entry; everything else (the tool catalog, pools, gateway, knowledge, GitHub, currency,
 * webhooks) admins. For enabling controls only, since the Hub checks every change again.
 */
export function canChangePath(who: SettingsRightsInput, path: Path): boolean {
  const { rights, email, document } = who;
  if (rights.admin || rights.owner) return true;
  const [section, id, ...below] = path;
  if (section === "projects" && id !== undefined) {
    if (below.length === 0) {
      return getAt(document, ["projects", id]) === undefined || rights.leads.includes(id);
    }
    return !isAdminShared(below) && rights.leads.includes(id);
  }
  if (section === "people" && id !== undefined) {
    return email !== null && sameAddress(id, email);
  }
  return false;
}

/**
 * Who changes the node at `path`, in the Hub's words for a refusal ("admins", "Booking's leads and
 * admins", "ana@acme.dev and admins"), so a page can name the owner next to a control that is off.
 */
export function ownersOfPath(document: SettingsDocument, path: Path): string {
  const [section, id, ...below] = path;
  if (section === "projects" && id !== undefined) {
    if (below.length === 0 && getAt(document, ["projects", id]) === undefined) return "any member";
    if (isAdminShared(below)) return "admins";
    const name = getAt(document, ["projects", id, "name"]);
    return `${typeof name === "string" && name !== "" ? name : id}'s leads and admins`;
  }
  if (section === "people" && id !== undefined) return `${id} and admins`;
  return "admins";
}

/**
 * How to call a person: the name the workspace's people list gives their address, else the name the
 * line or revision carried, else the part of the address before the `@`.
 */
export function personName(
  people: ReadonlyArray<SettingsPerson>,
  person: { readonly email: string; readonly name?: string | undefined },
): string {
  const listed = people
    .find((candidate) => sameAddress(candidate.email, person.email))
    ?.name.trim();
  if (listed !== undefined && listed !== "") return listed;
  const named = person.name?.trim();
  if (named !== undefined && named !== "") return named;
  return person.email.split("@")[0] || person.email;
}

/** The first letter of a name, for a mark. */
export const initialOf = (name: string): string => Array.from(name.trim())[0]?.toUpperCase() ?? "?";

/**
 * The revision `status.settings` says a workspace is at, which keys the view's query so it reads
 * again when it changes; undefined while the status says nothing of the workspace.
 */
export function knownRevision(
  status: Pick<PeerHubStatus, "settings">,
  workspace: string,
): number | undefined {
  return status.settings?.workspaces.find((entry) => entry.workspace === workspace)?.revision;
}

/** How many proposals the person decides the status counts in a workspace; undefined when it says nothing. */
export function knownPending(
  status: Pick<PeerHubStatus, "settings">,
  workspace: string,
): number | undefined {
  return status.settings?.workspaces.find((entry) => entry.workspace === workspace)
    ?.pendingProposals;
}
