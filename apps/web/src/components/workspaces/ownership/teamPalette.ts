import type { PeerHubStatus } from "@t3tools/contracts";
import { UsersIcon } from "lucide-react";

import type { PaletteAction } from "../slots.types";
import { openTeam } from "./teamNavigation";

/**
 * "Open Team" for each project of the person's workspaces whose ownership is known, which is where
 * the Team tile is: a project the Hub has not told ownership of has no Team page to open yet.
 */
export function teamPalette(
  status: Pick<PeerHubStatus, "signedIn" | "workspaces" | "ownership">,
): ReadonlyArray<PaletteAction> {
  if (!status.signedIn) return [];
  const known = new Set(
    (status.ownership?.projects ?? []).map((view) => `${view.workspace}/${view.project}`),
  );
  return status.workspaces.flatMap((workspace) =>
    workspace.projects
      .filter(({ project }) => known.has(`${workspace.slug}/${project.id}`))
      .map(({ project }): PaletteAction => ({
        value: `action:team:${workspace.slug}:${project.id}`,
        title: `Open Team · ${project.name}`,
        description: workspace.name,
        searchTerms: ["team", "owners", "owner map", "people", project.name, workspace.slug],
        icon: UsersIcon,
        run: async (navigate) => {
          openTeam(navigate, { workspace: workspace.slug, project: project.id });
        },
      })),
  );
}
