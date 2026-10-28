/**
 * What the People page asks and does, apart from how it draws: the addresses an invite names and
 * the role it gives (design artboard 15), and what removing someone from the workspace leaves
 * behind in projects (artboard 24): which projects still name them, and the one settings save that
 * takes them out of the projects the admin ticks. The Hub decides every invite, removal and save
 * again; these only shape what the dialogs offer and send.
 */
import { getAt } from "@t3tools/client-runtime/peer-settings";
import type { PeerInvitePreview, PeerRemovalPlan, PeerSettingsSet } from "@t3tools/contracts";

import { looksLikeEmail } from "../workspaceAccess.logic";
import { customAllocation, leadsOf, membersOf } from "./projectPeople.logic";
import { countInWords, joinNames } from "./reviewChanges.logic";
import type { SettingsDocument } from "./settingsView.logic";

export type InviteRole = "member" | "admin";

export const INVITE_ROLES: ReadonlyArray<{
  readonly id: InviteRole;
  readonly title: string;
  readonly description: (workspaceName: string) => string;
}> = [
  { id: "member", title: "Member", description: () => "Works in the projects they’re added to." },
  {
    id: "admin",
    title: "Admin",
    description: (workspaceName) =>
      `Also manages ${workspaceName}’s people, projects, capacity and integrations.`,
  },
];

export const INVITE_NOTE =
  "They get an email with the invitation, which expires after 14 days. The role applies as soon as they join.";

export const inviteLabel = (role: InviteRole): string =>
  role === "admin" ? "Invite as admin" : "Invite as member";

/** The most addresses one invite takes, so a pasted list cannot send a flood of mail. */
export const INVITE_LIMIT = 20;

export interface InviteAddresses {
  /** What looks like an address, once each, as typed. */
  readonly valid: ReadonlyArray<string>;
  /** What was typed that does not. */
  readonly invalid: ReadonlyArray<string>;
}

/**
 * The addresses in what was typed: split at commas, semicolons, new lines and spaces, an address in
 * angle brackets taken out of the name before it (`Mia <mia@northwind.dev>`), each once however it is
 * cased. The Hub checks every address again; this tells the person what it will not take.
 */
export function parseAddresses(text: string): InviteAddresses {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[,;\n]+/)) {
    const bracketed = [...part.matchAll(/<([^<>\s]+)>/g)].flatMap((match) => match[1] ?? []);
    for (const raw of bracketed.length === 0 ? part.split(/\s+/) : bracketed) {
      const token = raw.trim();
      const key = token.toLowerCase();
      if (token === "" || seen.has(key)) continue;
      seen.add(key);
      (looksLikeEmail(token) ? valid : invalid).push(token);
    }
  }
  return { valid, invalid };
}

/** What a mixed field says is wrong: the words that are no address. */
export const invalidText = (invalid: ReadonlyArray<string>): string =>
  `${joinNames(invalid.map((word) => `“${word}”`))} ${invalid.length === 1 ? "is" : "are"} not an email address.`;

/** "Invited mia@northwind.dev", "Invited 3 people as admins". */
export function invitedTitle(invited: ReadonlyArray<string>, role: InviteRole): string {
  const who = invited.length === 1 ? (invited[0] ?? "") : `${invited.length} people`;
  const as = role === "admin" ? (invited.length === 1 ? " as admin" : " as admins") : "";
  return `Invited ${who}${as}`;
}

/** A project that still names the person who is being removed. */
export interface NamingProject {
  readonly id: string;
  readonly name: string;
  /** What names them there, as the design writes it: "lead", "allocation €80", "member". */
  readonly detail: string;
  /** They are the only lead, so the project is left without one. */
  readonly onlyLead: boolean;
  /** The settings document has the project, so a save can take them out of it. */
  readonly editable: boolean;
}

const isMapping = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const includesAddress = (list: ReadonlyArray<string>, email: string) =>
  list.some((item) => sameAddress(item, email));

const compareNames = (a: NamingProject, b: NamingProject) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * The projects that still name the person: those the document lists them in (as a member, a lead
 * or with an allocation), and those the Hub's removal plan names that the document does not show
 * (listed, but not to be changed here). Without the document only the plan's are known.
 * `fallbackName` names a project the document does not hold.
 */
export function projectsNaming(input: {
  readonly document: SettingsDocument | null;
  readonly email: string;
  /** The ids the removal plan says the configuration still names the person in. */
  readonly planned: ReadonlyArray<string>;
  readonly currency: string;
  readonly fallbackName?: (projectId: string) => string | undefined;
}): ReadonlyArray<NamingProject> {
  const { document, email } = input;
  const projects = document === null ? undefined : getAt(document, ["projects"]);
  const entries = isMapping(projects) ? Object.entries(projects) : [];
  const rows = new Map<string, NamingProject>();
  for (const [id, entry] of entries) {
    if (!isMapping(entry)) continue;
    const leads = leadsOf(entry);
    const member = includesAddress(membersOf(entry), email);
    const lead = includesAddress(leads, email);
    const allocation = customAllocation(entry, email, input.currency);
    if (!member && !lead && allocation === null) continue;
    const name = typeof entry.name === "string" && entry.name !== "" ? entry.name : id;
    const detail =
      [lead ? "lead" : null, allocation === null ? null : `allocation ${allocation}`]
        .filter((part) => part !== null)
        .join(" · ") || "member";
    rows.set(id, {
      id,
      name,
      detail,
      onlyLead: lead && leads.length === 1,
      editable: true,
    });
  }
  for (const id of input.planned) {
    if (rows.has(id)) continue;
    rows.set(id, {
      id,
      name: input.fallbackName?.(id) ?? id,
      detail: "named in the configuration",
      onlyLead: false,
      editable: false,
    });
  }
  return [...rows.values()].toSorted(compareNames);
}

/**
 * The sets that take the person out of these projects, in one save: their place in `members`
 * (never the `*` of a project open to everyone), in `leads`, and their custom allocation, since the
 * Hub refuses a lead or an allocation for someone the project does not name. Only what names them
 * is set, so a project the person is only a lead of changes nothing else. Projects the document
 * does not have are left alone.
 */
export function cleanupSets(
  document: SettingsDocument,
  email: string,
  projectIds: ReadonlyArray<string>,
): PeerSettingsSet[] {
  const sets: PeerSettingsSet[] = [];
  for (const id of projectIds) {
    const entry = getAt(document, ["projects", id]);
    if (!isMapping(entry)) continue;
    const members = Array.isArray(entry.members) ? membersOf(entry) : [];
    if (includesAddress(members, email)) {
      sets.push({
        path: ["projects", id, "members"],
        value: members.filter((member) => !sameAddress(member, email)),
      });
    }
    const leads = leadsOf(entry);
    if (includesAddress(leads, email)) {
      sets.push({
        path: ["projects", id, "leads"],
        value: leads.filter((lead) => !sameAddress(lead, email)),
      });
    }
    const allocations = getAt(entry, ["capacity", "shared", "allocations"]);
    if (isMapping(allocations) && Object.keys(allocations).some((key) => sameAddress(key, email))) {
      sets.push({
        path: ["projects", id, "capacity", "shared", "allocations"],
        value: Object.fromEntries(
          Object.entries(allocations).filter(([key]) => !sameAddress(key, email)),
        ),
      });
    }
  }
  return sets;
}

/** The reason the save carries into the history. */
export const removalMessage = (name: string, workspaceName: string): string =>
  `Removed ${name} from ${workspaceName}`;

/** The destructive button: it says how far the removal goes. */
export function removeLabel(workspaceName: string, listed: number, picked: number): string {
  if (listed === 0) return `Remove from ${workspaceName}`;
  if (picked === 0) return `Remove from ${workspaceName} only`;
  return `Remove from ${workspaceName} and ${picked} ${picked === 1 ? "project" : "projects"}`;
}

/** "Mia is still named in two projects. Take Mia out of them too:" (the design avoids pronouns). */
export function stillNamedText(name: string, count: number): string {
  return count === 1
    ? `${name} is still named in one project. Take ${name} out of it too:`
    : `${name} is still named in ${countInWords(count)} projects. Take ${name} out of them too:`;
}

/** What a project is left with once its only lead goes. */
export const noLeadNote = (projectName: string, workspaceName: string): string =>
  `${projectName} will have no lead. Only admins of ${workspaceName} can change it then.`;

/** What the Hub's configuration names without the settings to change it here. */
export function unchangeableText(name: string, projects: ReadonlyArray<string>): string {
  return `The workspace configuration still names ${name} in ${joinNames(projects)}. ${name} stays named there until it is changed.`;
}

/**
 * What removing a member does, one line each, from the Hub's plan: the access that ends, the keys
 * that are revoked, the way back, the invitations that are withdrawn, and what the Hub cannot reach.
 * A Hub that cannot say what removal does says so.
 */
export function removalConsequences(input: {
  readonly name: string;
  readonly workspaceName: string;
  readonly plan: PeerRemovalPlan;
}): ReadonlyArray<string> {
  const { name, workspaceName, plan } = input;
  const reach = "Local clones and git host access must be reviewed separately.";
  if ("unsupported" in plan) {
    return [
      `This Hub cannot preview the effect. Removal ends ${name}’s current access to ${workspaceName}, but this older Hub may allow ${name} to rejoin by domain. Update Peer Hub for durable removal and retried key revocation.`,
      reach,
    ];
  }
  const keys = plan.keys;
  const invites = plan.invites ?? 0;
  return [
    `${name} loses access to ${workspaceName}.`,
    ...(keys > 0
      ? [`${name}’s ${keys} shared-capacity ${keys === 1 ? "key is" : "keys are"} revoked.`]
      : []),
    `${name} cannot rejoin by domain until an admin invites ${name} again.`,
    ...(invites > 0
      ? [
          `${invites} ${invites === 1 ? "invitation" : "invitations"} ${name} sent ${invites === 1 ? "is" : "are"} withdrawn.`,
        ]
      : []),
    reach,
  ];
}

/** What the follow-up save tells the person when it worked. */
export function tookOutText(name: string, projects: ReadonlyArray<string>): string {
  return `Took ${name} out of ${joinNames(projects)}`;
}

/** What it tells them when it did not: the removal itself stands. */
export function tookOutFailed(name: string, workspaceName: string, reason: string): string {
  return `${name} is removed from ${workspaceName}, but the projects still name ${name}: ${reason}`;
}

/** What the invite dialog says an invitation reaches, before it is sent. */
export interface InviteReach {
  readonly projects: string;
  readonly restricted: string | null;
  readonly capacity: string | null;
  /** The invitations would be more than the limit: someone could not join. */
  readonly overLimit: string | null;
  readonly person: string | null;
}

/**
 * One address’s access and admission facts. A batch must read this separately for every address.
 */
export function inviteReach(preview: PeerInvitePreview, workspaceName: string): InviteReach {
  const { capacity } = preview;
  const limit = capacity.memberLimit;
  const over = limit !== null && preview.wouldExceed;
  return {
    projects:
      preview.openProjects.length === 0
        ? `They have no project access in ${workspaceName} yet; add them to one once they join.`
        : `They work in ${joinNames(preview.openProjects)} once they join.`,
    restricted:
      preview.restrictedProjects.length === 0
        ? null
        : `${joinNames(preview.restrictedProjects)} ${preview.restrictedProjects.length === 1 ? "needs" : "need"} them added in the project’s People tab.`,
    capacity:
      limit === null
        ? null
        : `${capacity.members} of ${limit} members${capacity.pending > 0 ? `, ${capacity.pending} more invited` : ""}.`,
    overLimit: over
      ? `That is more than ${workspaceName}’s limit of ${limit} members: someone could not join until the Hub’s administrator raises its capacity.`
      : null,
    person: preview.alreadyMember
      ? `${preview.email} is already a member.`
      : preview.readmits
        ? `${preview.email} was removed before; this invites them back.`
        : null,
  };
}

/** A Hub refusal the People page words itself: its code, its HTTP status and the Hub's words. */
export interface InviteFailure {
  readonly message: string;
  readonly code?: string | undefined;
  readonly status?: number | undefined;
}

/**
 * What the invite dialog says of an address the Hub refused. An address an admin removed comes back
 * by an admin's invitation only; someone else's pending invitation is named by the Hub's details,
 * which the server already put in words. Anything else in the Hub's own words.
 */
export function inviteRefusal(address: string, failure: InviteFailure): string {
  if (failure.code === "removed")
    return `An admin removed ${address}; only an admin can invite them again.`;
  if (failure.code === "invitation_pending") return failure.message;
  return `Could not invite ${address}: ${failure.message}`;
}
