/**
 * The types of the mobile slots for Peer plugins. They live apart from the registry in `slots.ts`
 * so the plugins that fill the slots can import them without importing the registry that lists
 * them.
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
