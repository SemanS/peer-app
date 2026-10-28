/**
 * What a person reads when the Hub refuses with a code clients tell apart. The Hub's own message
 * names the rule; these say what to do about it, and who can.
 *
 * @module peerHub/core/hub/refusals
 */
import { PEER_HUB_REFUSAL_CODES } from "@t3tools/contracts";

const memberLimitOf = (details: unknown): number | null => {
  if (typeof details !== "object" || details === null || !("memberLimit" in details)) return null;
  const limit = details.memberLimit;
  return typeof limit === "number" && Number.isFinite(limit) ? limit : null;
};

const textOf = (details: unknown, key: string): string | null => {
  if (typeof details !== "object" || details === null || !(key in details)) return null;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

/** The words for a refusal with `code`, or the Hub's `message` where the code needs none. */
export function refusalText(code: string, message: string, details: unknown): string {
  switch (code) {
    case PEER_HUB_REFUSAL_CODES.teamCapacityRequired: {
      const limit = memberLimitOf(details);
      return `${
        limit === null
          ? "This organization has as many members as its capacity allows."
          : `This organization has reached its limit of ${limit} members.`
      } Ask the Hub's administrator to raise its capacity; the invitation stays pending until then.`;
    }
    case PEER_HUB_REFUSAL_CODES.inviteExpired:
      return "This invitation has expired. Ask an admin of the organization to send it again.";
    case "invitation_pending": {
      // Someone else's invitation to that address is pending: a second one would replace theirs.
      const by = textOf(details, "invitedBy");
      const email = textOf(details, "email");
      return by === null
        ? message
        : `${by} already invited ${email ?? "them"}; ask ${by} or an admin.`;
    }
    case "founding_expired":
      return "This offer has expired. Ask the Hub's administrator to send it again.";
    case "not_founding_owner":
      return "This organization was founded for another address. Sign in with that address to accept it.";
    default:
      return message;
  }
}
