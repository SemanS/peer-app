import {
  PEER_MEMORY_AVAILABLE,
  type PeerHubStatus,
  type PeerPluginId,
  type PeerPluginState,
} from "@t3tools/contracts";
import {
  hubFeatureState,
  pluginLockNote,
  type InactivePluginReason,
} from "@t3tools/client-runtime/peer/plugins";

/** On, off, or on but waiting for a Peer Hub that serves what the plugin needs. */
type PluginRowState = "on" | "off" | "hub";

/** One plugin as Settings → Peer → Coordination & plugins shows it. */
export interface PluginRow {
  readonly id: string;
  readonly title: string;
  readonly state: PluginRowState;
  /** The owner's choice, which a switch shows. */
  readonly on: boolean;
  /** Owners get a switch; everyone else reads the state. */
  readonly control: "switch" | "state";
  /** A change of this plugin is in flight. */
  readonly busy: boolean;
  readonly locked: boolean;
  readonly note: string | null;
  /** What its last turn-off cleanup, or its background work, failed with. */
  readonly error: string | null;
}

const HUB_NOTE = "The Hub must be updated before this works.";

export function pluginRows(
  plugins: ReadonlyArray<PeerPluginState>,
  input: { readonly owner: boolean; readonly pending: string | null },
): ReadonlyArray<PluginRow> {
  return plugins
    .filter((plugin) => plugin.id !== "memory" || PEER_MEMORY_AVAILABLE)
    .map((plugin) => {
      const waitingForHub = plugin.enabled && plugin.reason === "hub";
      return {
        id: plugin.id,
        title: plugin.title,
        state: !plugin.enabled ? "off" : waitingForHub ? "hub" : "on",
        on: plugin.enabled,
        control: input.owner ? "switch" : "state",
        busy: input.pending === plugin.id,
        locked: plugin.locked === true,
        note: pluginLockNote(plugin) ?? (waitingForHub ? HUB_NOTE : null),
        error: plugin.error ?? null,
      };
    });
}

const REASON_TEXT: Readonly<Record<InactivePluginReason, string>> = {
  off: "is turned off on this environment.",
  hub: "needs a newer Peer Hub.",
  missing: "is not available on this environment.",
  locked: "is forced off by the environment operator.",
};

/**
 * How a plugin's name continues to say why it is not active. A Hub that does not serve the feature
 * either has it turned off by its operator, which a Hub that lists such features says
 * (`featuresOff`), or is too old for it, which is all an older Hub's silence lets a client say.
 */
export function reasonText(
  reason: InactivePluginReason,
  status: Pick<PeerHubStatus, "hub">,
  plugin: PeerPluginId,
): string {
  return reason === "hub" && hubFeatureState(status, plugin) === "off"
    ? "is turned off on this Peer Hub."
    : REASON_TEXT[reason];
}
