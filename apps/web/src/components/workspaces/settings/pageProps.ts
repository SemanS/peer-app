import type {
  PeerSlotProps,
  ProjectSettingsSlotProps,
  WorkspaceSettingsSlotProps,
} from "../slots.types";

/**
 * What a page of the area gets, which is what a plugin's settings slot for the same scope gets, so
 * the slot components and today's rows drop into a page unchanged.
 */
export type ComputerPageProps = PeerSlotProps;
export type WorkspacePageProps = WorkspaceSettingsSlotProps;
export type ProjectPageProps = ProjectSettingsSlotProps;
