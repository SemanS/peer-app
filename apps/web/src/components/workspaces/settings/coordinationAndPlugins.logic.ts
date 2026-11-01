/**
 * What this computer's Plugins page works out: each Peer plugin with whether it is on and where
 * that comes from. Pure, so the page only draws it.
 */
import type { PeerHubInfo, PeerPluginState } from "@t3tools/contracts";

import type { ConnectionState } from "../../settings/connectionStatus.logic";
import { pluginRows } from "../PeerPluginsSettings.logic";

/**
 * One plugin as the page draws it: the chip (its status in the one language every connection
 * speaks, then where that comes from), what to say under it, its switch. A plugin that is on and
 * served is Connected; Off is the owner's choice; Not available is the Hub, an operator or an
 * older Hub deciding.
 */
export interface PluginView {
  readonly id: string;
  readonly title: string;
  readonly status: ConnectionState;
  /** Says more than the state's name ("Checking…"). */
  readonly statusLabel?: string | undefined;
  /**
   * Where that comes from: "by you", "turned off on this Hub", "needs a newer Hub", "sign in to a
   * Peer Hub"; empty where the status needs nothing added.
   */
  readonly source: string;
  /** A line under the title: what forces it off, or what the Hub needs. */
  readonly note: string | null;
  /** What stops applying while the Hub keeps its feature off; the page words it with what it knows. */
  /** What its last cleanup, or its background work, failed with. */
  readonly error: string | null;
  /** The switch shows what is true now, not what its owner once chose, where the Hub or an operator decides. */
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly busy: boolean;
}

/**
 * The plugins whose Hub feature the signed-in Hub has turned off, by plugin id (a plugin's id is its
 * Hub feature's): what it lists as turned off by its operator (`featuresOff`).
 */
export function hubOffPlugins(
  hub: Pick<PeerHubInfo, "featuresOff"> | undefined,
): ReadonlySet<string> {
  return new Set(hub?.featuresOff ?? []);
}

/**
 * Each plugin of the environment with its status and where it comes from: the owner's own choice
 * (`by you`), an operator forcing it off, the Hub turning its feature off, or the Hub being too
 * old to have it. Its owner gets a switch to change their choice; everyone else reads it.
 */
export function pluginViews(
  plugins: ReadonlyArray<PeerPluginState>,
  input: {
    readonly owner: boolean;
    /** The plugin whose change is on its way. */
    readonly pending: string | null;
    readonly hubOff: ReadonlySet<string>;
    /** Whether someone is signed in to a Hub, when known. */
    readonly signedIn?: boolean;
  },
): ReadonlyArray<PluginView> {
  const own = input.owner ? "by you" : "by this computer’s owner";
  return pluginRows(plugins, input).map((row): PluginView => {
    const base = {
      id: row.id,
      title: row.title,
      note: row.note,
      error: row.error,
      busy: row.busy,
    } as const;
    // The Hub or an operator decides these: the switch shows that, and is not for changing it.
    const decided = { checked: false, disabled: true } as const;
    if (row.locked) {
      return {
        ...base,
        ...decided,
        status: "unavailable",
        source: "forced off by the operator",
      };
    }
    if (!row.on) {
      return {
        ...base,
        status: "off",
        source: own,
        checked: false,
        disabled: row.busy || !input.owner,
      };
    }
    if (input.hubOff.has(row.id)) {
      return {
        ...base,
        ...decided,
        note: null,
        status: "unavailable",
        source: "turned off on this Hub",
      };
    }
    if (row.state === "hub") {
      return { ...base, ...decided, status: "unavailable", source: "needs a newer Hub" };
    }
    if (row.state === "waiting") {
      // Signed out nothing is being checked: the plugin works once the person signs in.
      return input.signedIn === false
        ? { ...base, ...decided, status: "unavailable", source: "sign in to a Peer Hub" }
        : { ...base, ...decided, status: "off", statusLabel: "Checking…", source: "" };
    }
    return {
      ...base,
      status: "connected",
      source: own,
      checked: true,
      disabled: row.busy || !input.owner,
    };
  });
}
