/**
 * What the People page says of each person, apart from how it draws: one list where an invitation
 * is a person's state, the access a person has in plain words, and the work of a project as areas
 * and tasks to tick. The Hub decides every change again; these only shape what the page offers.
 */
import type { PeerInvitation, PeerWorkspaceMembers } from "@t3tools/contracts";
import { invitationView, sortInvitations } from "@t3tools/client-runtime/peer-organizations";

type Member = PeerWorkspaceMembers["members"][number];
type Removed = NonNullable<PeerWorkspaceMembers["removed"]>[number];

export type PersonState = "active" | "invited" | "expired" | "removed";

/** The list's filter: everyone, or one state, an expired invitation among the invited. */
export type PeopleFilter = "all" | "active" | "invited" | "removed";

export const PEOPLE_FILTERS: ReadonlyArray<{ readonly id: PeopleFilter; readonly label: string }> =
  [
    { id: "all", label: "All people" },
    { id: "active", label: "Active" },
    { id: "invited", label: "Invited" },
    { id: "removed", label: "Removed" },
  ];

export interface PersonRow {
  readonly email: string;
  readonly name: string | null;
  readonly state: PersonState;
  /** "Member · Formbricks", "Invited · All projects". */
  readonly summary: string;
  readonly stateLabel: string;
  readonly member: Member | null;
  readonly invitation: PeerInvitation | null;
  readonly removed: Removed | null;
}

/** Two letters for a person's mark: of their name's words, else of their address. */
export function initials(name: string | null, email: string): string {
  const words = (name ?? "").trim().split(/\s+/u).filter(Boolean);
  const letters =
    words.length >= 2
      ? `${words[0]!.charAt(0)}${words.at(-1)!.charAt(0)}`
      : (words[0] ?? email).slice(0, 2);
  return letters.toUpperCase();
}

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** The access a list of projects means: every project without a list, else their names. */
export function accessText(
  projects: ReadonlyArray<string> | null | undefined,
  nameOf: (project: string) => string | undefined,
): string {
  if (projects === null || projects === undefined) return "All projects";
  if (projects.length === 0) return "No project yet";
  return projects.map((id) => nameOf(id) ?? id).join(", ");
}

/**
 * Everyone the workspace knows of, once each: members first, then open invitations and people who
 * were removed. An accepted invitation is its member's row and a revoked one is nobody's. From a
 * Hub that does not list invitations (`invitations` null), the members answer's pending ones.
 */
export function peopleRows(input: {
  readonly members: PeerWorkspaceMembers | null;
  readonly invitations: ReadonlyArray<PeerInvitation> | null;
  readonly projectName: (id: string) => string | undefined;
  readonly now: number;
}): ReadonlyArray<PersonRow> {
  const { members, projectName, now } = input;
  const joined = (members?.members ?? []).map((member): PersonRow => {
    const all = member.role !== "member";
    return {
      email: member.email,
      name: member.name ?? null,
      state: "active",
      summary: `${capitalized(member.role)} · ${accessText(all ? null : member.projects, projectName)}`,
      stateLabel: "Active",
      member,
      invitation: null,
      removed: null,
    };
  });
  const known = new Set(joined.map((row) => row.email.toLowerCase()));
  const listed =
    input.invitations ??
    (members?.invites ?? []).map((invite) => ({ ...invite, status: "pending" as const }));
  const invited = sortInvitations(listed as ReadonlyArray<PeerInvitation>, now).flatMap(
    (invitation): ReadonlyArray<PersonRow> => {
      if (known.has(invitation.email.toLowerCase())) return [];
      const view = invitationView(invitation, now);
      if (view.status !== "pending" && view.status !== "expired") return [];
      const expired = view.status === "expired";
      return [
        {
          email: invitation.email,
          name: null,
          state: expired ? "expired" : "invited",
          summary: `Invited · ${accessText(invitation.projects?.length ? invitation.projects : null, projectName)}`,
          stateLabel: expired ? "Expired" : "Pending",
          member: null,
          invitation,
          removed: null,
        },
      ];
    },
  );
  const gone = (members?.removed ?? []).map((removed): PersonRow => ({
    email: removed.email,
    name: null,
    state: "removed",
    summary: "No access",
    stateLabel: "Removed",
    member: null,
    invitation: null,
    removed,
  }));
  return [...joined, ...invited, ...gone];
}

/** The rows a search and a filter leave. */
export function filterPeople(
  rows: ReadonlyArray<PersonRow>,
  search: string,
  filter: PeopleFilter,
): ReadonlyArray<PersonRow> {
  const words = search.trim().toLowerCase();
  return rows.filter((row) => {
    const inFilter =
      filter === "all" ||
      (filter === "invited"
        ? row.state === "invited" || row.state === "expired"
        : row.state === filter);
    if (!inFilter || words === "") return inFilter;
    return `${row.name ?? ""} ${row.email} ${row.summary}`.toLowerCase().includes(words);
  });
}

/** What the empty list says, by why it is empty. */
export function noPeopleText(search: string, filter: PeopleFilter): string {
  if (search.trim() !== "") return `Nobody matches “${search.trim()}”.`;
  return filter === "all" ? "Nobody here yet. Invite someone to start." : "Nobody in this view.";
}

/** The access chosen in a form: every project, or the ones ticked. */
export type ProjectAccess =
  | { readonly mode: "all" }
  | { readonly mode: "selected"; readonly projects: ReadonlyArray<string> };

export const accessOf = (limit: ReadonlyArray<string> | null | undefined): ProjectAccess =>
  limit === null || limit === undefined ? { mode: "all" } : { mode: "selected", projects: limit };

/** What a save sends for it: the list of projects, or null for every project. */
export const limitOf = (access: ProjectAccess): ReadonlyArray<string> | null =>
  access.mode === "all" ? null : access.projects;
