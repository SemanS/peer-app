import type { PeerAuditEntry } from "@t3tools/contracts";

/** How a line of the log calls the person an address belongs to. */
export type AuditName = (email: string) => string;

const asWritten: AuditName = (email) => email;

/**
 * The names of a workspace's people by address, ignoring case. An address with no name stays as it
 * is: the log must still say who it was of someone who has since left.
 */
export function auditNames(
  people: ReadonlyArray<{ readonly email: string; readonly name: string }>,
): AuditName {
  const named = new Map(
    people.flatMap((person) => {
      const name = person.name.trim();
      return name === "" ? [] : [[person.email.toLowerCase(), name] as const];
    }),
  );
  return (email) => named.get(email.toLowerCase()) ?? email;
}

/**
 * Whose address the subject of an event is: a member's for a membership event, the key holder's for
 * a key. Other subjects are a secret's name or a task, which are not people.
 */
const subjectIsPerson = (kind: string) => kind.startsWith("member.") || kind.startsWith("key.");

/**
 * An event as a sentence. People are called by `nameOf` (their name, where the workspace has one,
 * else their address). Unknown future event kinds remain visible without interpreting their detail
 * payload.
 */
export function describeAuditEntry(entry: PeerAuditEntry, nameOf: AuditName = asWritten): string {
  const actor = entry.actor.type === "hub" ? "Peer Hub" : nameOf(entry.actor.email);
  const subject =
    entry.subject === null
      ? "the workspace"
      : subjectIsPerson(entry.kind)
        ? nameOf(entry.subject)
        : entry.subject;
  const count =
    typeof entry.details.keysQueued === "number"
      ? ` (${entry.details.keysQueued} keys queued for revocation)`
      : "";
  switch (entry.kind) {
    case "member.invited":
      return `${actor} invited ${subject}${entry.details.readmits ? " back" : ""}`;
    case "member.invite-withdrawn":
      return `${actor} withdrew the invite for ${subject}`;
    case "member.joined":
      return `${actor} joined the workspace`;
    case "member.left":
      return `${actor} left the workspace${count}`;
    case "member.removed":
      return `${actor} removed ${subject}${count}`;
    case "member.role-changed":
      return `${actor} changed ${subject}'s role from ${String(entry.details.from ?? "unknown")} to ${String(entry.details.to ?? "unknown")}`;
    case "workspace.created":
      return `${actor} created the workspace`;
    case "workspace.renamed":
      return `${actor} renamed the workspace`;
    case "workspace.domains-changed":
      return `${actor} changed the workspace's domains`;
    case "config.applied":
      return `${actor} applied configuration ${String(entry.details.revision ?? "")}`.trim();
    case "secret.written":
      return `${actor} wrote secret ${subject}`;
    case "key.issued":
      return `${actor} issued a shared-capacity key for ${subject}${entry.project ? ` in ${entry.project}` : ""}`;
    case "key.revocation-queued":
      return `${actor} queued ${String(entry.details.count ?? "")} key revocations for ${subject}`;
    case "key.revoked":
      return `${actor} revoked a key for ${subject}`;
    case "project.shared":
      return `${actor} shared project ${entry.project ?? subject}`;
    case "project.unshared":
      return `${actor} unshared project ${entry.project ?? subject}`;
    case "task.closed":
      return `${actor} closed task ${subject}`;
    case "task.reopened":
      return `${actor} reopened task ${subject}`;
    case "task.deleted":
      return `${actor} deleted task ${String(entry.details.title ?? subject)}`;
    default:
      return `${actor}: ${entry.kind}${entry.subject ? ` · ${entry.subject}` : ""}`;
  }
}

/** The first characters of a session reference, which is all a person reads. */
const SESSION_SHORT = 8;

/**
 * One event of the log as a row: the sentence, when it happened (as long ago, with the exact time
 * for a tooltip), and the session it was made in, shortened to be read and whole to be copied.
 * `ago` and `exact` write an instant as "2h ago" and as a date and time; an instant they cannot
 * write stays as the Hub wrote it.
 */
export function auditRow(
  entry: PeerAuditEntry,
  input: {
    readonly nameOf: AuditName;
    readonly ago: (iso: string) => string;
    readonly exact: (iso: string) => string;
  },
) {
  const session = entry.actor.type === "person" ? entry.actor.session : "";
  return {
    text: describeAuditEntry(entry, input.nameOf),
    relative: input.ago(entry.at) || entry.at,
    exact: input.exact(entry.at) || entry.at,
    session: session === "" ? null : { short: session.slice(0, SESSION_SHORT), full: session },
  };
}
