/**
 * Slots for Peer plugins on mobile. The Peer workspaces screen and the Settings index render the
 * slots of the plugins that are active on the environment; a plugin that is off, absent or not
 * served by the Hub contributes nothing.
 *
 * A plugin's screens live in `features/peer/<id>/` and are listed once in `PEER_MOBILE_PLUGINS`,
 * in the order the server lists plugins: that order is the order on screen.
 */
import type {
  EnvironmentId,
  PeerAgentRequest,
  PeerHubStatus,
  PeerPluginId,
  PeerProjectState,
  PeerTask,
} from "@t3tools/contracts";
import type { ComponentType } from "react";

import { herdrMobilePlugin } from "./herdr";
import { memoryMobilePlugin } from "./memory";
import { requestsMobilePlugin } from "./requests";
import { selectPeerPlugins } from "./slots.logic";

/** What a section of one environment gets: the environment and its status as the screen read it. */
export interface PeerEnvironmentProps {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly status: PeerHubStatus;
}

/** What a workspace section gets, and the active plugins whose capabilities it may use. */
export interface PeerSectionProps extends PeerEnvironmentProps {
  readonly plugins: ReadonlyArray<PeerMobilePlugin>;
}

export interface PeerTaskProps extends PeerEnvironmentProps {
  readonly workspace: string;
  readonly project: PeerProjectState;
  readonly task: PeerTask;
  /** Another action on the screen is running: controls wait. */
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
}

/** Starts an agent on a task in its own checkout; with a request, it accepts that request. */
export interface TaskLauncherProps extends PeerTaskProps {
  readonly request?: PeerAgentRequest;
}

/** `tasks`: right below the task list. `end`: below the coordination controls. */
export type WorkspaceSectionPlace = "tasks" | "end";

export interface PeerMobilePlugin {
  readonly id: PeerPluginId;
  /** Sections of an environment on the Peer workspaces screen. */
  readonly workspaceSections?: ReadonlyArray<{
    readonly place: WorkspaceSectionPlace;
    readonly Component: ComponentType<PeerSectionProps>;
  }>;
  /** Sections for the task the person selected. */
  readonly taskSections?: ComponentType<PeerTaskProps>;
  /** Rows of the Settings index, under Projects & threads; each decides whether it shows. */
  readonly settingsRows?: ComponentType;
  /** Capability: starts an agent on a task. At most one plugin fills it. */
  readonly taskLauncher?: ComponentType<TaskLauncherProps>;
}

/** Every plugin with a mobile screen, in the order the server lists plugins. */
export const PEER_MOBILE_PLUGINS: ReadonlyArray<PeerMobilePlugin> = [
  herdrMobilePlugin,
  requestsMobilePlugin,
  memoryMobilePlugin,
];

const selections = new Map<string, ReadonlyArray<PeerMobilePlugin>>();

/**
 * The plugins whose screens to show: those active on the environment. The same list, by identity,
 * comes back until a plugin turns on or off, so screens pass it down without re-rendering.
 */
export function usePeerMobilePlugins(
  status: PeerHubStatus | null,
): ReadonlyArray<PeerMobilePlugin> {
  const selected = selectPeerPlugins(PEER_MOBILE_PLUGINS, status);
  const key = selected.map((plugin) => plugin.id).join(",");
  const known = selections.get(key);
  if (known !== undefined) return known;
  selections.set(key, selected);
  return selected;
}
