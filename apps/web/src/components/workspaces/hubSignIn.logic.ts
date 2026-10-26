import { pendingFoundings } from "@t3tools/client-runtime/peer-organizations";
import type { PeerHubStatus } from "@t3tools/contracts";

/**
 * Where a person stands on the way into a Peer Hub: this computer's Peer has not answered yet,
 * nobody is signed in, someone is signed in and has an organization to choose (none joined yet, or
 * one founded for them waits), or they are in.
 */
export type HubSignInStage = "connecting" | "sign-in" | "choose" | "in";

export function hubSignInStage(
  status: Pick<PeerHubStatus, "signedIn" | "workspaces" | "foundings"> | null,
): HubSignInStage {
  if (status === null) return "connecting";
  if (!status.signedIn) return "sign-in";
  if (status.workspaces.length === 0 || pendingFoundings(status).length > 0) return "choose";
  return "in";
}

/**
 * The sidebar's line where the active organization's name sits: a way to sign in while nobody is,
 * a way to choose an organization while the person has none, and nothing else (the organization
 * names itself). Nothing before this computer's Peer has answered, so it does not flicker in.
 */
export function hubSidebarEntry(
  status: Pick<PeerHubStatus, "signedIn" | "workspaces"> | null,
): "sign-in" | "choose" | null {
  if (status === null) return null;
  if (!status.signedIn) return "sign-in";
  return status.workspaces.length === 0 ? "choose" : null;
}

/** The environments on which the person chose "Use Peer without a Hub" on the start screen. */
export type HubCardDismissals = ReadonlyArray<string>;

/**
 * What the start screen's "Connect your team's Peer Hub" card shows: the sign-in until it is
 * dismissed on this environment, and the organization choice right after signing in, whatever was
 * dismissed (signing in asked for it). Null hides the card.
 */
export function hubCardStage(input: {
  readonly status: Pick<PeerHubStatus, "signedIn" | "workspaces"> | null;
  readonly environmentId: string | null;
  readonly dismissed: HubCardDismissals;
}): "sign-in" | "choose" | null {
  if (input.environmentId === null || input.status === null) return null;
  if (input.status.signedIn) return input.status.workspaces.length === 0 ? "choose" : null;
  return input.dismissed.includes(input.environmentId) ? null : "sign-in";
}

/** The dismissals with this environment added, once. */
export function dismissHubCard(dismissed: HubCardDismissals, environmentId: string) {
  return dismissed.includes(environmentId) ? dismissed : [...dismissed, environmentId];
}
