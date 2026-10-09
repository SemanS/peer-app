/**
 * The types of the web slots for Peer plugins. They live apart from the registry in `slots.ts`
 * so the plugins that fill the slots can import them without importing the registry that lists
 * them.
 */
import type {
  ContextMenuItem,
  EnvironmentId,
  PeerAgentRequest,
  PeerHubStatus,
  PeerPluginId,
  PeerProjectState,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import type { useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

import type { ProjectCheckout } from "./useOpenWorkspaceProject";
import type { WorkProjectNode, WorkTaskNode, WorkThreadNode } from "./workTree.logic";

/** What every slot gets: the environment it shows, and its status as the view read it. */
export interface PeerSlotProps {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}

/**
 * What Needs you's items get: the environment, its status, and the active plugins, whose
 * capabilities (the task launcher, say) an item may use.
 */
export interface NeedsYouSlotProps extends PeerSlotProps {
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
}

export interface ProjectSlotProps extends PeerSlotProps {
  readonly project: WorkProjectNode;
  /** The route the sidebar highlights, in `workTree` terms (`knowledge:<workspace>:<project>`). */
  readonly activeThread: string | null;
}

export interface TaskSlotProps extends PeerSlotProps {
  readonly workspace: string;
  /** Undefined while the workspace does not list the project. */
  readonly project: PeerProjectState | undefined;
  readonly task: WorkTaskNode;
}

export interface ThreadSlotProps {
  readonly thread: WorkThreadNode;
}

export interface TaskContextSlotProps extends PeerSlotProps {
  readonly workspace: string;
  readonly project: string;
  /** `task:<id>`, or `project` for the work on no task. */
  readonly scope: string;
  /** The context as the page shows it; null while no agent started one. */
  readonly contextText: string | null;
}

export interface WorkspaceSettingsSlotProps extends PeerSlotProps {
  readonly workspace: PeerWorkspaceState;
}

export interface ProjectSettingsSlotProps extends PeerSlotProps {
  readonly workspace: PeerWorkspaceState;
  readonly state: PeerProjectState;
}

export interface NotOpenHereSlotProps extends PeerSlotProps {
  readonly checkout: ProjectCheckout;
  /** The last clone or open failed and nothing is running now. */
  readonly failed: boolean;
  /** Tries to open the project again, e.g. once what was missing is connected. */
  readonly onRetry: () => void;
}

/** Starts an agent on a task in its own checkout; with a request, it accepts that request. */
export interface TaskLauncherProps extends PeerSlotProps {
  readonly workspace: string;
  readonly project: PeerProjectState;
  readonly taskId: string;
  readonly taskLabel: string;
  readonly request?: PeerAgentRequest;
  readonly initialOpen?: boolean;
  readonly onClose?: () => void;
}

/** One item a plugin adds to a thread's menu, and what picking it does. */
export interface TaskMenuEntry {
  readonly item: ContextMenuItem<string>;
  readonly run: (choice: string) => void;
}

export interface ThreadMenuEntry {
  readonly item: ContextMenuItem<string>;
  /** `start` sits ahead of "Move to task", `end` after it. */
  readonly place: "start" | "end";
  readonly run: () => void;
}

export type PeerNavigate = ReturnType<typeof useNavigate>;

/** An action a plugin adds to the command palette. */
export interface PaletteAction {
  readonly value: string;
  readonly title: string;
  readonly description: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly icon: LucideIcon;
  readonly run: (navigate: PeerNavigate) => Promise<void>;
}

export interface PeerWebPlugin {
  readonly id: PeerPluginId;
  /** A section of the Work panel, above the projects. */
  readonly workPanel?: ComponentType<PeerSlotProps>;
  /** Items that wait on the person. `count` joins the section's count; `Component` follows its cards. */
  readonly needsYou?: {
    readonly count?: (status: PeerHubStatus) => number;
    readonly Component?: ComponentType<NeedsYouSlotProps>;
    /** What the empty section says when this plugin knows more than "nothing", or null. */
    readonly emptyText?: (
      status: PeerHubStatus,
      input: { readonly running: number },
    ) => string | null;
  };
  /** Header buttons of a project. */
  readonly projectActions?: ComponentType<ProjectSlotProps>;
  /** Rows at the top of an open project. */
  readonly projectRows?: ComponentType<ProjectSlotProps>;
  /** Actions on a task row, shown on hover or focus. */
  readonly taskActions?: ComponentType<TaskSlotProps>;
  readonly taskMenu?: (props: TaskSlotProps) => ReadonlyArray<TaskMenuEntry>;
  /** Marks on a task row, always visible. */
  readonly taskBadges?: ComponentType<TaskSlotProps>;
  /** Items in the menu of a thread of the person's on this computer. */
  readonly threadMenu?: (
    thread: WorkThreadNode,
    environmentId: EnvironmentId | null,
  ) => ReadonlyArray<ThreadMenuEntry>;
  /** Marks on a thread card. */
  readonly threadBadges?: ComponentType<ThreadSlotProps>;
  /** Sections of a task's (or a project's) context page. */
  readonly taskContext?: ComponentType<TaskContextSlotProps>;
  /** Rows of Settings → Workspaces, for the environment. */
  readonly settings?: ComponentType<PeerSlotProps>;
  /** Rows of Settings → Workspaces, under each project. */
  readonly workspaceSettings?: ComponentType<WorkspaceSettingsSlotProps>;
  readonly projectSettings?: ComponentType<ProjectSettingsSlotProps>;
  /** Actions in the command palette. */
  readonly palette?: (status: PeerHubStatus) => ReadonlyArray<PaletteAction>;
  /** Capability: starts an agent on a task. At most one plugin fills it. */
  readonly taskLauncher?: ComponentType<TaskLauncherProps>;
  /** What a project that is not open here offers once opening it failed. */
  readonly notOpenHere?: ComponentType<NotOpenHereSlotProps>;
  /** A note in the form that shares a project with the workspace. */
  readonly shareProject?: ComponentType<PeerSlotProps>;
}
