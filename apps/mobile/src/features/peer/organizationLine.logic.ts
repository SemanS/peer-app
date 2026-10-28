/**
 * What the phone says of the person in an organization: their role, whether it is their only one,
 * and the projects an invitation limited them to ("on Webshop only"), as the desktop's workspace
 * list says it. Read-only: only an admin, on the desktop, changes a limit.
 */
import type { PeerWorkspaceState } from "@t3tools/contracts";

const listed = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export function organizationLine(
  workspace: Pick<PeerWorkspaceState, "role" | "limitedTo" | "projects">,
  memberships: number,
): string {
  const role = workspace.role;
  const part =
    role === "owner" ? "You own it" : role === "admin" ? "You’re an admin" : "You’re a member";
  const only = workspace.limitedTo ?? [];
  const limit =
    only.length === 0
      ? ""
      : ` on ${listed(
          only.map(
            (id) => workspace.projects.find(({ project }) => project.id === id)?.project.name ?? id,
          ),
        )} only`;
  return memberships === 1 ? `Your organization · ${part}${limit}` : `${part}${limit}`;
}
