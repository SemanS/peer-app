import type { PeerHubStatus } from "@t3tools/contracts";

import type { ConnectionState } from "../settings/connectionStatus.logic";
import { hubAddress } from "./settings/hubStatus.logic";

/** The Hub dot in the sidebar's footer: how the connection stands, and what it says on hover. */
export interface HubDot {
  readonly state: ConnectionState;
  /** "Peer Hub · connected to hub.webinson.com". */
  readonly title: string;
  /** When the Hub last answered, while it is connected. */
  readonly syncedAt: string | null;
}

/**
 * The dot reads the status the way Settings does: the Hub answered and nothing failed is
 * connected; a failed sync is a problem; not signed in needs setup. Before this computer's Peer
 * has answered at all it is off, not a problem.
 */
export function hubDot(
  status: Pick<PeerHubStatus, "signedIn" | "hubUrl" | "error" | "lastSyncAt" | "workspaces"> | null,
): HubDot {
  if (status === null) {
    return { state: "off", title: "Peer Hub · waiting for this computer's Peer", syncedAt: null };
  }
  if (!status.signedIn) {
    return {
      state: "off",
      title: "Peer Local · Hub is optional. Connect a team under Settings › Peer",
      syncedAt: null,
    };
  }
  const failing = status.workspaces.find((workspace) => workspace.error !== null);
  const problem =
    status.error ?? (failing === undefined ? null : `${failing.name}: ${failing.error}`);
  if (problem !== null) {
    return { state: "problem", title: `Peer Hub · ${problem}`, syncedAt: null };
  }
  return {
    state: "connected",
    title: `Peer Hub · connected to ${hubAddress(status.hubUrl)}`,
    syncedAt: status.lastSyncAt,
  };
}
