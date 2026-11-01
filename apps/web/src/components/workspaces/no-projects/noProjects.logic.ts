import type { PeerWorkspaceRole } from "@t3tools/contracts";

/** An admin of the workspace, as the person may be told to ask them. */
export interface WorkspaceAdmin {
  readonly email: string;
  readonly name: string;
}

/**
 * The people who may add someone to a project: the workspace's owners and admins, in the order
 * the Hub lists its people. A person with no name is called by the part of their address before `@`.
 */
export function adminsOf(
  people: ReadonlyArray<{
    readonly email: string;
    readonly name: string;
    readonly role: PeerWorkspaceRole;
  }>,
): ReadonlyArray<WorkspaceAdmin> {
  return people
    .filter((person) => person.role !== "member")
    .map((person) => ({
      email: person.email,
      name: person.name.trim() === "" ? (person.email.split("@")[0] ?? person.email) : person.name,
    }));
}

/** `Slavo`, `Slavo and Eva`, `Slavo, Eva and Ana`. */
export function listNames(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** What Work says to a member of a workspace who is on none of its projects. */
export function memberWords(input: {
  readonly workspaceName: string;
  readonly admins: ReadonlyArray<WorkspaceAdmin>;
}) {
  const { workspaceName, admins } = input;
  const adding = "Project leads and admins add people in a project’s settings.";
  return {
    title: `You’re in ${workspaceName}, but not on a project yet`,
    text:
      admins.length === 0
        ? adding
        : `${adding} Admins in ${workspaceName}: ${listNames(admins.map((admin) => admin.name))}.`,
  };
}

/** What Work says to an admin of a workspace that has no project. */
export function adminWords(input: { readonly workspaceName: string; readonly several: boolean }) {
  return {
    title: input.several ? `Set up ${input.workspaceName}` : "Set up your workspace",
    text: "Four steps get it ready for your team. Each opens the page that does it.",
  };
}
