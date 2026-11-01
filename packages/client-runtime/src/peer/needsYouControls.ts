import { AuthAccessWriteScope, type PeerHubStatus } from "@t3tools/contracts";

/**
 * T3 Connect is the relay that carries phone alerts, so its name stays where it names that service;
 * the first time a line mentions it, it says what it is.
 */
const RELAY = "T3 Connect, Peer’s relay";
export function alertsControlState(
  status: Pick<PeerHubStatus, "needsYou"> | null,
  scopes: ReadonlyArray<string>,
) {
  const alerts = status?.needsYou?.alerts;
  if (!alerts)
    return {
      state: "hidden" as const,
      enabled: false,
      disabled: true,
      explanation: "Update Peer on this computer to use Phone alerts.",
    };
  const permitted = scopes.includes(AuthAccessWriteScope);
  const explanation = !permitted
    ? "Only this computer’s owner can change Phone alerts."
    : alerts.delivery === "not-linked"
      ? `Link this computer to ${RELAY}. A direct connection alone cannot send Phone alerts.`
      : alerts.delivery === "publishing-off"
        ? `Turn on agent activity publishing for this computer in ${RELAY}.`
        : `Titles only, sent to your phone through ${RELAY}. Alerts follow its notification and quiet switches. Turn them on for one computer.`;
  return {
    state: !permitted
      ? ("no-permission" as const)
      : alerts.delivery === "ready"
        ? alerts.enabled
          ? ("ready-on" as const)
          : ("ready-off" as const)
        : alerts.delivery,
    enabled: alerts.enabled,
    disabled: !permitted,
    explanation,
  };
}
