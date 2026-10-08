import { PEER_MEMORY_AVAILABLE, type PeerPluginState } from "@t3tools/contracts";

/** On, off, or on but waiting for a Peer Hub that serves what the plugin needs. */
type PluginRowState = "on" | "off" | "hub";

/** One plugin as Settings → Workspaces → Peer plugins shows it. */
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
        note: waitingForHub ? HUB_NOTE : null,
        error: plugin.error ?? null,
      };
    });
}
