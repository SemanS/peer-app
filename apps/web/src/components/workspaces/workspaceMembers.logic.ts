import type { PeerRemovalPlan, PeerWorkspaceMembers, PeerWorkspaceRole } from "@t3tools/contracts";

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
