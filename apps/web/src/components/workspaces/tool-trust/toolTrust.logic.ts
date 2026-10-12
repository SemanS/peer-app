/**
 * What the tool trust review says of the workspace file and of each tool's state, apart from how it
 * draws: who applied the file (or that nobody did), and a tool's state as one of the connection
 * statuses Peer shows everywhere.
 */
import type { ToolTrustRow } from "@t3tools/client-runtime/peer-tool-trust";
import { toolTrustStateLabel } from "@t3tools/client-runtime/peer-tool-trust";

import type { ConnectionState } from "../../settings/connectionStatus.logic";

export const MANAGED_IN_PEER = "Managed in Peer — no workspace file applied";

/**
 * The line under a workspace's name: "Applied by Ana · 2h ago" for a file somebody applied, "Managed
 * in Peer — no workspace file applied" where nobody did (never an empty name or a date in 1970), and
 * nothing where this computer does not know the workspace's tools yet. `ago` writes a time as
 * "2h ago".
 */
export function appliedByLine(
  group: {
    readonly appliedBy?: string | undefined;
    readonly appliedAt?: string | undefined;
    readonly managedInPeer: boolean;
  },
  ago: (iso: string) => string,
): string | null {
  if (group.appliedBy !== undefined && group.appliedAt !== undefined) {
    return `Applied by ${group.appliedBy} · ${ago(group.appliedAt)}`;
  }
  return group.managedInPeer ? MANAGED_IN_PEER : null;
}

const TOOL_STATE: Readonly<Record<ToolTrustRow["state"], ConnectionState>> = {
  on: "connected",
  review: "setup",
  changed: "setup",
  secret: "setup",
  off: "off",
  invalid: "problem",
};

/**
 * A tool's state as a status: the connection state it stands for (an approved tool is connected,
 * one that waits on this person needs setup, one that is off is off, one that cannot run is a
 * problem) and the word that says which.
 */
export const toolStateBadge = (
  state: ToolTrustRow["state"],
): { readonly state: ConnectionState; readonly label: string } => ({
  state: TOOL_STATE[state],
  label: toolTrustStateLabel[state],
});
