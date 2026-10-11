import { inactivePluginReason } from "@t3tools/client-runtime/peer/plugins";

import { usePeerSettings } from "./PeerSettingsContext";

/**
 * Where an edit would be, when the settings plugin cannot be used: the Hub is older than the
 * settings feature, or the environment's owner turned the plugin off. The page around it shows what
 * it read from the manifest, and nothing is editable. Renders nothing while settings are available.
 */
export function SettingsUnavailableNote() {
  const { status } = usePeerSettings();
  const reason = inactivePluginReason(status, "settings");
  if (reason === null) return null;
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {reason === "hub"
        ? "Needs a newer Peer Hub."
        : reason === "off"
          ? "Changing settings here is turned off on this environment. Its owner turns it on in Coordination & plugins."
          : reason === "locked"
            ? "Changing settings here is forced off by the environment operator."
            : "Changing settings here is not available on this environment."}
    </p>
  );
}
