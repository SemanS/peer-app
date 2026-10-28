/**
 * Session roles on the phone, read-only: the label a review session carries on its agent's card
 * and in the selected task's section. The words come from the shared roles helpers, so the phone
 * says "reviewing" and "reviewing · advisory" exactly as web does; roles change on a computer.
 */
import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import {
  isAdvisory,
  roleDetail,
  roleLabel,
  threadRole,
  type RolesStatusView,
} from "@t3tools/client-runtime/peer/roles";
import type { PeerHubStatus } from "@t3tools/contracts";

import type { SignalTone } from "../slotTypes";

/** A role as a chip says it: a review Peer enforces in the team's teal, else in amber. */
export interface RoleChip {
  readonly tone: SignalTone;
  readonly label: string;
  readonly detail: string;
}

const toneOf = (role: {
  readonly advisory: boolean;
  readonly changedFiles: boolean;
}): SignalTone => (role.advisory || role.changedFiles ? "needs" : "team");

/** The role chip of an agent's card on the Work board, or null when its session has no role. */
export function threadRoleChip(
  status: RolesStatusView | null,
  thread: { readonly key: string; readonly harness?: string | undefined },
): RoleChip | null {
  const role = threadRole(status, thread);
  if (role === undefined) return null;
  return { tone: toneOf(role), label: role.label, detail: role.detail };
}

/** One session on the task with a role, as the task's section lists it. */
export interface TaskRoleRow extends RoleChip {
  readonly key: string;
  /** "You", the member's name, or their address when the project does not list them. */
  readonly who: string;
  /** What the session is, as coordination labels it. */
  readonly session: string;
}

type TaskRolesStatus = Pick<PeerHubStatus, "plugins" | "roles" | "mcp" | "coordination" | "email">;

/**
 * The sessions on a task that have a role, newest first: the Hub's role rows of the project whose
 * sessions coordination reports on the task. A colleague's session reads the same as one's own.
 */
export function taskRoleRows(
  status: TaskRolesStatus,
  place: { readonly workspace: string; readonly project: string; readonly task: string },
  members: ReadonlyArray<{ readonly email: string; readonly name: string }>,
): ReadonlyArray<TaskRoleRow> {
  if (!activePlugin(status, "roles")) return [];
  const onTask = new Map(
    status.coordination.sessions
      .filter(
        (session) =>
          session.workspace === place.workspace &&
          session.project === place.project &&
          session.task === place.task,
      )
      .map((session) => [session.id, session] as const),
  );
  const rows = (status.roles?.projects ?? [])
    .filter((project) => project.workspace === place.workspace && project.project === place.project)
    .flatMap((project) => project.roles)
    .filter((row) => onTask.has(row.session))
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  return rows.map((row) => {
    const advisory = isAdvisory({ session: row.session, mcpSessions: status.mcp?.sessions });
    const changedFiles = row.changedFiles === true;
    const mine = status.email !== null && row.email.toLowerCase() === status.email.toLowerCase();
    return {
      key: row.session,
      who: mine
        ? "You"
        : (members.find((member) => member.email.toLowerCase() === row.email.toLowerCase())?.name ??
          row.email),
      session: onTask.get(row.session)?.label ?? row.session,
      tone: toneOf({ advisory, changedFiles }),
      label: roleLabel(row.role, advisory),
      detail: roleDetail(row.role, { advisory, changedFiles, pending: false }),
    };
  });
}
