import {
  PEER_MEMORY_AVAILABLE,
  PEER_PLUGIN_REASONS,
  type PeerHubStatus,
  type PeerPluginId,
  type PeerPluginState,
} from "@t3tools/contracts";
import {
  featuresBuiltWithout,
  hubFeatureState,
  pluginLockNote,
  type InactivePluginReason,
} from "@t3tools/client-runtime/peer/plugins";

/**
 * On, off, on but waiting for a Peer Hub that serves what the plugin needs (`hub`), or on and
 * waiting for any Hub to answer (`waiting`: signed out, or not reached since the environment
 * started), when nobody can say yet whether it serves the plugin.
 */
type PluginRowState = "on" | "off" | "hub" | "waiting";

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
const SIGN_IN_NOTE = "Works once you sign in to a Peer Hub.";
const REACH_NOTE = "Works once Peer reaches its Peer Hub.";

export function pluginRows(
  plugins: ReadonlyArray<PeerPluginState>,
  input: {
    readonly owner: boolean;
    readonly pending: string | null;
    /** Whether someone is signed in to a Hub, when known. */
    readonly signedIn?: boolean;
  },
): ReadonlyArray<PluginRow> {
  return plugins
    .filter((plugin) => plugin.id !== "memory" || PEER_MEMORY_AVAILABLE)
    .map((plugin) => {
      const waitingForHub =
        plugin.enabled &&
        (plugin.reason === PEER_PLUGIN_REASONS.hub ||
          plugin.reason === PEER_PLUGIN_REASONS.hubUnknown);
      // No Hub has said whether it serves the plugin. Signed out, none can: an environment from
      // before `hub-unknown` names it `hub` then.
      const unanswered =
        plugin.reason === PEER_PLUGIN_REASONS.hubUnknown || input.signedIn === false;
      return {
        id: plugin.id,
        title: plugin.title,
        state: !plugin.enabled ? "off" : !waitingForHub ? "on" : unanswered ? "waiting" : "hub",
        on: plugin.enabled,
        control: input.owner ? "switch" : "state",
        busy: input.pending === plugin.id,
        locked: plugin.locked === true,
        note:
          pluginLockNote(plugin) ??
          (!waitingForHub
            ? null
            : !unanswered
              ? HUB_NOTE
              : input.signedIn === false
                ? SIGN_IN_NOTE
                : REACH_NOTE),
        error: plugin.error ?? null,
      };
    });
}

const REASON_TEXT: Readonly<Record<InactivePluginReason, string>> = {
  off: "is turned off on this environment.",
  hub: "needs a newer Peer Hub.",
  waiting: "works once Peer reaches its Peer Hub.",
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
  status: Pick<PeerHubStatus, "hub"> & { readonly signedIn?: boolean },
  plugin: PeerPluginId,
): string {
  if (reason === "waiting" && status.signedIn === false) {
    return "works once you sign in to a Peer Hub.";
  }
  if (reason === "hub" && featuresBuiltWithout(status).has(plugin)) {
    return "is not available: this Peer Hub was built without it.";
  }
  return reason === "hub" && hubFeatureState(status, plugin) === "off"
    ? "is turned off on this Peer Hub."
    : REASON_TEXT[reason];
}
