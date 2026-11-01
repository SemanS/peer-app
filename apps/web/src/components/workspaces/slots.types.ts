/**
 * The types of the web slots for Peer plugins. They live apart from the registry in `slots.ts`
 * so the plugins that fill the slots can import them without importing the registry that lists
 * them.
 */
import type {
  EnvironmentId,
  PeerHubStatus,
  PeerPluginId,
  PeerProjectState,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import type { useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

import type { WorkProjectNode, WorkTaskNode } from "./workTree.logic";

/** What every slot gets: the environment it shows, and its status as the view read it. */
export interface PeerSlotProps {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}

export interface ProjectSlotProps extends PeerSlotProps {
  readonly project: WorkProjectNode;
  /** The route the sidebar highlights, in `workTree` terms (`team:<workspace>:<project>`). */
  readonly activeThread: string | null;
}

export interface TaskSlotProps extends PeerSlotProps {
  readonly workspace: string;
  /** Undefined while the workspace does not list the project. */
  readonly project: PeerProjectState | undefined;
  readonly task: WorkTaskNode;
  /** The checkout is on jj, so a section speaks before any of the task's threads does. */
  readonly onJujutsu?: boolean;
}

export interface WorkspaceSettingsSlotProps extends PeerSlotProps {
  readonly workspace: PeerWorkspaceState;
}

/** A workspace the person belongs to that lists no project for them. */
export interface NoProjectsSlotProps extends PeerSlotProps {
  readonly workspace: PeerWorkspaceState;
}

export interface ProjectSettingsSlotProps extends PeerSlotProps {
  readonly workspace: PeerWorkspaceState;
  readonly state: PeerProjectState;
}

/** Starts an agent on a task in its own checkout. */
export interface TaskLauncherProps extends PeerSlotProps {
  readonly workspace: string;
  readonly project: PeerProjectState;
  readonly taskId: string;
  readonly taskLabel: string;
  /** Task pages keep the brief, editable prompt and explicit launch on the page. */
  readonly inline?: boolean;
  readonly initialPrompt?: string;
  readonly repositoryId?: string;
  readonly initialOpen?: boolean;
  /**
   * Opens with "Start from" on this base bookmark, as an integration made for the task (jj
   * projects only). Without it the dialog starts from main.
   */
  readonly baseBranch?: string;
  readonly onClose?: () => void;
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
  /**
   * What Work says, in place of its plain line, for each workspace in which the person is on no
   * project yet: who to ask to be added, or how to start one. The first active plugin that fills it
   * speaks for every such workspace; without one Work keeps its plain line.
   */
  readonly noProjects?: ComponentType<NoProjectsSlotProps>;
  /** Items that wait on the person, above the projects. */
  readonly needsYou?: ComponentType<PeerSlotProps>;
  /** Rows at the top of an open project, for what holds now. */
  readonly projectRows?: ComponentType<ProjectSlotProps>;
  /** Actions on a task row, shown on hover or focus. */
  readonly taskActions?: ComponentType<TaskSlotProps>;
  /** A task's changes, in its room. */
  readonly taskSections?: ComponentType<TaskSlotProps>;
  /** Rows of Settings → Peer for the environment, on the page `slotHost` names. */
  readonly settings?: ComponentType<PeerSlotProps>;
  /** Informational settings for a registered feature, including its inactive state. */
  readonly alwaysSettings?: ComponentType<PeerSlotProps>;
  /** Rows of Settings → Peer for a workspace, on the page `slotHost` names. */
  readonly workspaceSettings?: ComponentType<WorkspaceSettingsSlotProps>;
  /** Actions in the command palette. */
  readonly palette?: (status: PeerHubStatus) => ReadonlyArray<PaletteAction>;
}
