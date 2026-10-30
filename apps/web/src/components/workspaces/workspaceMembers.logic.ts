import type {
  PeerInvitation,
  PeerRemovalPlan,
  PeerWorkspaceMembers,
  PeerWorkspaceRole,
  PeerWorkspaceState,
} from "@t3tools/contracts";

export function memberActions(actor: PeerWorkspaceRole, target: PeerWorkspaceRole, self: boolean) {
  const manage = actor !== "member" && (target !== "owner" || actor === "owner");
  return { changeRole: manage, revokeKeys: actor !== "member" || self, remove: manage && !self };
}
export function removalConfirmation(name: string, email: string, plan: PeerRemovalPlan): string {
  if ("unsupported" in plan)
    return `Remove ${email} from ${name}? This hub cannot preview the effect. Removal ends their current workspace access, but this older hub may allow them to rejoin by domain. Update Peer Hub for durable removal and retried key revocation. Local clones and git host access must be reviewed separately.`;
  return `Remove ${email} from ${name}? They lose workspace access. ${plan.keys} shared-capacity keys will be revoked. They cannot rejoin by domain until an admin invites them back.${plan.invites ? ` ${plan.invites} invitations they sent will be withdrawn.` : ""}${plan.projects.length ? ` Configuration still names them in: ${plan.projects.join(", ")}.` : ""} Local clones and git host access must be reviewed separately.`;
}
export function pendingRevocationsWarning(pending: PeerWorkspaceMembers["pendingRevocations"]) {
  if (!pending?.count) return null;
  return `${pending.count} key revocations are waiting for the gateway${pending.lastError ? ` (last error: ${pending.lastError})` : ""}.`;
}

type InviterWorkspace = Pick<PeerWorkspaceState, "role" | "projects">;
const isAdmin = (role: PeerWorkspaceRole) => role === "owner" || role === "admin";

/** A project an invitation may name, or a member's limit may hold. */
export interface ProjectChoice {
  readonly id: string;
  readonly name: string;
}

/**
 * How the person invites: an admin invites anyone, as a member or an admin, and may name any of
 * the projects; a lead who is no admin invites members to the projects they lead; anyone else
 * does not invite (null).
 */
export function inviter(workspace: InviterWorkspace): {
  readonly as: "admin" | "lead";
  readonly projects: ReadonlyArray<ProjectChoice>;
} | null {
  const all = workspace.projects.map(({ project }) => ({ id: project.id, name: project.name }));
  if (isAdmin(workspace.role)) return { as: "admin", projects: all };
  const led = workspace.projects
    .filter(({ project }) => project.role === "lead")
    .map(({ project }) => ({ id: project.id, name: project.name }));
  return led.length === 0 ? null : { as: "lead", projects: led };
}

/** A task an invitation may hand the person: one of a named project's, not done. */
export interface TaskChoice {
  readonly id: string;
  readonly project: string;
  /** "VL7 Split payments", with the project's name where more than one project is named. */
  readonly label: string;
}

const listed = (names: ReadonlyArray<string>) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** "on Webshop only", "on Webshop and Billing only"; a project the person cannot see, by its id. */
export function limitWords(
  projects: ReadonlyArray<string>,
  nameOf: (project: string) => string | undefined,
): string {
  if (projects.length === 0) return "on no project yet";
  return `on ${listed(projects.map((id) => nameOf(id) ?? id))} only`;
}

/**
 * The person's own limit as their workspace page says it beside their role: "on Webshop only";
 * undefined when they are on every project they are given.
 */
export function ownLimit(
  workspace: Pick<PeerWorkspaceState, "limitedTo" | "projects">,
): string | undefined {
  const only = workspace.limitedTo ?? [];
  return only.length === 0
    ? undefined
    : limitWords(
        only,
        (id) => workspace.projects.find(({ project }) => project.id === id)?.project.name,
      );
}

/**
 * What the person may do with a member's limit: an admin widens, narrows or lifts it (`edit`);
 * a lead who is no admin adds a limited member to a project they lead that the limit leaves out
 * (`addTo`), and takes nothing away. A member without a limit is on every open project already.
 */
export function limitActions(input: {
  readonly workspace: InviterWorkspace;
  readonly member: {
    readonly role: PeerWorkspaceRole;
    readonly projects?: ReadonlyArray<string> | null | undefined;
  };
}): { readonly edit: boolean; readonly addTo: ReadonlyArray<ProjectChoice> } {
  const { workspace, member } = input;
  const limit = member.projects ?? null;
  if (isAdmin(workspace.role)) return { edit: member.role === "member", addTo: [] };
  if (limit === null) return { edit: false, addTo: [] };
  const led = inviter(workspace)?.projects ?? [];
  return { edit: false, addTo: led.filter((project) => !limit.includes(project.id)) };
}

/**
 * What an invitation's row says of whom it is for: "On Webshop only · VL7 waits for them", and
 * once accepted, "VL7 had been taken meanwhile" when somebody else owned it by then, or "VL7 was
 * done meanwhile" when it was done by then; either way nobody became its owner through the
 * invitation. Null for an invitation to the whole workspace.
 */
export function invitationScope(
  invitation: Pick<PeerInvitation, "projects" | "task" | "taskOutcome">,
  names: {
    readonly project: (id: string) => string | undefined;
    readonly task: (id: string) => string | undefined;
  },
): string | null {
  const projects = invitation.projects ?? [];
  if (projects.length === 0) return null;
  const only = limitWords(projects, names.project);
  const task = invitation.task ?? null;
  if (task === null) return `${only.charAt(0).toUpperCase()}${only.slice(1)}`;
  const label = names.task(task) ?? task;
  const outcome =
    invitation.taskOutcome === "taken-meanwhile"
      ? `${label} had been taken meanwhile`
      : invitation.taskOutcome === "done-meanwhile"
        ? `${label} was done meanwhile`
        : `${label} waits for them`;
  return `${only.charAt(0).toUpperCase()}${only.slice(1)} · ${outcome}`;
}
