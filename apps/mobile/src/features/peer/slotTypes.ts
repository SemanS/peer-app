/**
 * The types of the mobile slots for Peer plugins. They live apart from the registry in `slots.ts`
 * so the plugins that fill the slots can import them without importing the registry that lists
 * them.
 */
import type { WorkProjectNode } from "@t3tools/client-runtime/peer/work";
import type {
  EnvironmentId,
  PeerAgentRequest,
  PeerHubStatus,
  PeerPluginId,
  PeerProjectState,
  PeerTask,
} from "@t3tools/contracts";
import type { ComponentType } from "react";

import type { AppSymbolName } from "../../components/ui/AppSymbol";

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
  readonly onRequestOutcome?: (outcome: "accepted" | "start-not-confirmed") => void;
}

/** `tasks`: right below the task list. `end`: below the coordination controls. */
export type WorkspaceSectionPlace = "tasks" | "end";

/**
 * The color of a signal, one per kind of conversation, as on web: what waits on a person (amber),
 * an agent at work (blue), delivery (green), agent ↔ agent (orange), context and knowledge
 * (violet), team ↔ agents (teal).
 */
export type SignalTone =
  | "needs"
  | "working"
  | "delivery"
  | "coordination"
  | "knowledge"
  | "team"
  | "neutral";

/** A project's signal, as web's `ProjectSignal` without `open`: the phone opens only what it has. */
export interface ProjectSignal {
  readonly id: string;
  readonly label: string;
  readonly icon: AppSymbolName;
  /** How many wait on people or agents; null for a signal without a count. */
  readonly count: number | null;
  /** A line on it: what waits, or why there is nothing. */
  readonly detail: string;
  readonly tone: SignalTone;
}

export interface PeerMobilePlugin {
  readonly background?: ComponentType<{ readonly environmentIds: ReadonlyArray<EnvironmentId> }>;
  readonly id: PeerPluginId;
  /** Readonly presentation of a registered feature, including its inactive state. */
  readonly alwaysWorkspaceSections?: ReadonlyArray<{
    readonly key: string;
    readonly place: WorkspaceSectionPlace;
    readonly Component: ComponentType<PeerSectionProps>;
  }>;
  /** Sections of an environment on the Peer workspaces screen. */
  readonly workspaceSections?: ReadonlyArray<{
    readonly place: WorkspaceSectionPlace;
    readonly Component: ComponentType<PeerSectionProps>;
  }>;
  /**
   * A project's signals on the Work screen: chips on its card while they count something, and a
   * row each above its threads. The status is the computer's that reports the project.
   */
  readonly projectSignals?: (
    status: PeerHubStatus,
    project: WorkProjectNode,
  ) => ReadonlyArray<ProjectSignal>;
  /** Sections for the task the person selected. */
  readonly taskBadges?: ComponentType<PeerTaskProps>;
  readonly taskSections?: ComponentType<PeerTaskProps>;
  /** Rows of the Settings index, under Projects & threads; each decides whether it shows. */
  readonly settingsRows?: ComponentType;
  /** Capability: starts an agent on a task. At most one plugin fills it. */
  readonly taskLauncher?: ComponentType<TaskLauncherProps>;
}
