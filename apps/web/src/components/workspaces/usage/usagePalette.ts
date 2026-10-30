import type { PeerHubStatus } from "@t3tools/contracts";
import { ChartNoAxesColumnIcon } from "lucide-react";

import type { PaletteAction, PeerNavigate, ProjectNavRow } from "../slots.types";

export function openWorkspaceUsage(navigate: PeerNavigate, workspace: string) {
  return navigate({ to: "/team-usage/$workspace", params: { workspace } });
}

/** The workspace's row in the sidebar's Activity. */
export function usageNavRow(workspace: { readonly slug: string }): ProjectNavRow {
  return {
    label: "Workspace usage",
    icon: ChartNoAxesColumnIcon,
    open: (navigate) => openWorkspaceUsage(navigate, workspace.slug),
    active: (activeThread) => activeThread === `usage:${workspace.slug}`,
  };
}

/** One item for each of the person's workspaces, named apart from the local Usage page. */
export function usagePalette(
  status: Pick<PeerHubStatus, "signedIn" | "workspaces">,
): ReadonlyArray<PaletteAction> {
  if (!status.signedIn) return [];
  return status.workspaces.map((workspace) => ({
    value: `action:usage:${workspace.slug}`,
    title: `Workspace usage · ${workspace.name}`,
    description: "Tickets, agent work, spend and tokens",
    searchTerms: ["usage", "spend", "cost", "tokens", "team", workspace.name, workspace.slug],
    icon: ChartNoAxesColumnIcon,
    run: async (navigate) => {
      await openWorkspaceUsage(navigate, workspace.slug);
    },
  }));
}
