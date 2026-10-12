import { projectOwnership } from "@t3tools/client-runtime/peer/ownership";

import { SettingsRow } from "../../settings/settingsLayout";
import type { ProjectSettingsSlotProps } from "../slots.types";
import { ownersSummary } from "./ownership.logic";

/**
 * The Owners row on a project's Basics page: who may name owners, what renaming an area does to
 * them, and how many of the project's areas and open tasks have one. It is there while the plugin
 * is active; with it off, or without a Hub that serves it, nothing of ownership is shown.
 */
export function OwnersSettings({ status, workspace, state }: ProjectSettingsSlotProps) {
  const summary = ownersSummary(projectOwnership(status, workspace, state.project), state);
  return (
    <SettingsRow
      title="Owners"
      description="Leads and admins set who owns tasks and areas on the Team page. Renaming an area leaves its owner behind until a lead sets it again."
      status={
        summary === undefined ? undefined : <span className="text-foreground">{summary}</span>
      }
    />
  );
}
