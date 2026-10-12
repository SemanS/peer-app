/**
 * What Plans says in the phone's Settings index: how it stands on a computer. Pure, so the row only
 * draws it. What a task's list shows (the section, its relations, the count) is the client
 * runtime's, shared with web: `peer/plans-view`.
 */
import { inactivePluginReason } from "@t3tools/client-runtime/peer/plugins";
import type { PeerHubStatus } from "@t3tools/contracts";

/**
 * What Plans' row in Settings says of a computer, in the words of the plugin list: on, off, forced
 * off by the operator, waiting for a Hub, or needing a newer one. Null where the computer does not
 * list Plans. Why it is off, and the switch, are the plugin list's on the Peer workspaces screen,
 * which the row opens.
 */
export function plansRowValue(
  status: Pick<PeerHubStatus, "plugins" | "signedIn"> | null | undefined,
): string | null {
  switch (inactivePluginReason(status, "plans")) {
    case null:
      return "On";
    case "off":
      return "Off";
    case "locked":
      return "Forced off";
    case "waiting":
      return "Waits for a Hub";
    case "hub":
      return "Needs a newer Hub";
    case "missing":
      return null;
  }
}
