import type { PeerAuditEntry } from "@t3tools/contracts";

/** Unknown future event kinds remain visible without interpreting their detail payload. */
export function describeAuditEntry(entry: PeerAuditEntry): string {
  const actor = entry.actor.type === "hub" ? "Peer Hub" : entry.actor.email;
  const subject = entry.subject ?? "the workspace";
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
