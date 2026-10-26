import type { PeerFounding, PeerHubStatus, PeerInvitation } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

/**
 * What every client says about organizations (the Hub's workspaces): an organization a hub
 * administrator founded for the person, the one the app works in, and an invitation's state.
 */

/** The local keys that name a workspace; signing out forgets them so the next person starts clean. */
export const WORKSPACE_STORAGE_KEYS = ["peer:settings-workspace", "peer:work-scope"] as const;

/** Organizations founded for the signed-in person that wait for their answer. */
export function pendingFoundings(
  status: Pick<PeerHubStatus, "signedIn" | "foundings"> | null,
): ReadonlyArray<PeerFounding> {
  return status?.signedIn === true ? (status.foundings ?? []) : [];
}

const day = (iso: string | undefined): string | null => {
  if (iso === undefined) return null;
  const date = DateTime.make(iso);
  return Option.isNone(date)
    ? null
    : DateTime.formatLocal(date.value, {
        locale: "en",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
};

/** Whether an offer can still be accepted: the Hub's word, else its expiry against `now`. */
export function foundingExpired(founding: PeerFounding, now: number): boolean {
  if (founding.expired !== undefined) return founding.expired;
  if (founding.expiresAt === undefined) return false;
  const at = Date.parse(founding.expiresAt);
  return !Number.isNaN(at) && at <= now;
}

/** "Vocabulift is waiting for you as its owner", who founded it and until when. */
export function foundingWords(founding: PeerFounding, now: number) {
  const expired = foundingExpired(founding, now);
  const by =
    founding.initiatedBy === undefined
      ? "The Hub's administrator set it up for you."
      : `${founding.initiatedBy} set it up for you on this Hub.`;
  const until = day(founding.expiresAt);
  return {
    title: `${founding.name} is waiting for you as its owner`,
    detail: expired
      ? `${by} The offer expired; ask the Hub's administrator to send it again.`
      : `${by} As its owner you invite colleagues, add projects and set up its tools.${until === null ? "" : ` The offer is open until ${until}.`}`,
    expired,
  };
}

/**
 * The organization the app works in: the one chosen last while the person is still in it, else
 * the first. With one membership there is nothing to choose.
 */
export function activeOrganization<W extends { readonly slug: string }>(
  workspaces: ReadonlyArray<W>,
  chosen: string | null,
): W | null {
  return workspaces.find((workspace) => workspace.slug === chosen) ?? workspaces[0] ?? null;
}

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

/** An invitation's state; an older Hub lists only pending ones and says nothing of states. */
export function invitationStatus(invitation: PeerInvitation, now: number): InvitationStatus {
  switch (invitation.status) {
    case "accepted":
    case "expired":
    case "revoked":
      return invitation.status;
    default: {
      const at = invitation.expiresAt === undefined ? Number.NaN : Date.parse(invitation.expiresAt);
      return !Number.isNaN(at) && at <= now ? "expired" : "pending";
    }
  }
}

const STATUS_LABELS: Readonly<Record<InvitationStatus, string>> = {
  pending: "Pending",
  accepted: "Accepted",
  expired: "Expired",
  revoked: "Revoked",
};

/** What a row of the invitations says, and which of its actions apply. */
export function invitationView(invitation: PeerInvitation, now: number) {
  const status = invitationStatus(invitation, now);
  const delivery = invitation.delivery;
  const failed = status !== "accepted" && status !== "revoked" && delivery?.state === "failed";
  const until = day(invitation.expiresAt);
  const ended = day(invitation.at ?? undefined);
  const detail = [
    `${invitation.role === "admin" ? "Admin" : "Member"}`,
    invitation.invitedBy === undefined ? null : `invited by ${invitation.invitedBy}`,
    status === "pending" && until !== null ? `expires ${until}` : null,
    status === "expired" && until !== null ? `expired ${until}` : null,
    status === "accepted" && ended !== null ? `joined ${ended}` : null,
    status === "revoked" && ended !== null
      ? `revoked ${ended}${invitation.by ? ` by ${invitation.by}` : ""}`
      : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return {
    status,
    label: STATUS_LABELS[status],
    detail,
    /** Why the email did not go out, when its last attempt failed. */
    deliveryProblem: failed
      ? `The email could not be sent${delivery?.error ? `: ${delivery.error}` : "."} Send it again.`
      : null,
    /** A pending or expired invitation can be sent again (which renews it) or revoked. */
    canResend: status === "pending" || status === "expired",
    canRevoke: status === "pending" || status === "expired",
  };
}

/** Pending first (failed deliveries leading), then expired, then the ones that ended, newest first. */
export function sortInvitations(
  invitations: ReadonlyArray<PeerInvitation>,
  now: number,
): ReadonlyArray<PeerInvitation> {
  const rank = (invitation: PeerInvitation) => {
    const status = invitationStatus(invitation, now);
    if (status === "pending") return invitation.delivery?.state === "failed" ? 0 : 1;
    return status === "expired" ? 2 : 3;
  };
  const time = (invitation: PeerInvitation) =>
    Date.parse(invitation.at ?? invitation.invitedAt ?? "") || 0;
  return [...invitations].sort((a, b) => rank(a) - rank(b) || time(b) - time(a));
}
