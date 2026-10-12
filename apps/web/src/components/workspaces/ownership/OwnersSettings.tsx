import { projectOwnership } from "@t3tools/client-runtime/peer/ownership";
import { useNavigate } from "@tanstack/react-router";

import { SettingsRow } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import type { ProjectSettingsSlotProps } from "../slots.types";
import { ownersSummary } from "./ownership.logic";
import { openTeam } from "./teamNavigation";

/**
 * The Owners row on a project's Basics page: who may name owners, what renaming an area does to
 * them, how many of the project's areas and open tasks have one, and the way to the Team page,
 * where they are named. It is there while the plugin is active; with it off, or without a Hub that
 * serves it, nothing of ownership is shown.
 */
export function OwnersSettings({ status, workspace, state }: ProjectSettingsSlotProps) {
  const navigate = useNavigate();
  const summary = ownersSummary(projectOwnership(status, workspace, state.project), state);
  return (
    <SettingsRow
      title="Owners"
      description="Leads and admins set who owns tasks and areas on the Team page. Renaming an area leaves its owner behind until a lead sets it again."
      status={
        summary === undefined ? undefined : <span className="text-foreground">{summary}</span>
      }
      control={
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            openTeam(navigate, { workspace: workspace.slug, project: state.project.id })
          }
        >
          Open Team
        </Button>
      }
    />
  );
}
