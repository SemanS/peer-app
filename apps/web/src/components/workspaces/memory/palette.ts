import { FileSearchIcon } from "lucide-react";
import type { PeerHubStatus } from "@t3tools/contracts";

import type { PaletteAction } from "../slots.types";

/** "Open Memory" for the company's knowledge and for each project of the person's workspaces. */
export function memoryPalette(status: PeerHubStatus): ReadonlyArray<PaletteAction> {
  if (!status.signedIn) return [];
  return status.workspaces.flatMap((workspace): PaletteAction[] => [
    {
      value: `action:memory:${workspace.slug}:company`,
      title: "Open Memory · Company knowledge",
      description: workspace.name,
      searchTerms: ["memory", "company", "knowledge", "review", workspace.slug],
      icon: FileSearchIcon,
      run: async (navigate) => {
        await navigate({
          to: "/memory/$workspace/$project",
          params: { workspace: workspace.slug, project: "company" },
          search: {},
        });
      },
    },
    ...workspace.projects.map(({ project }): PaletteAction => ({
      value: `action:memory:${workspace.slug}:${project.id}`,
      title: `Open Memory · ${project.name}`,
      description: workspace.name,
      searchTerms: [
        "memory",
        "findings",
        "evidence",
        "topics",
        "review",
        project.name,
        workspace.slug,
      ],
      icon: FileSearchIcon,
      run: async (navigate) => {
        await navigate({
          to: "/memory/$workspace/$project",
          params: { workspace: workspace.slug, project: project.id },
          search: {},
        });
      },
    })),
  ]);
}
