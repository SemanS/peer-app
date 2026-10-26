import { activeOrganization } from "@t3tools/client-runtime/peer-organizations";
import type { PeerHubStatus } from "@t3tools/contracts";
import { Building2Icon } from "lucide-react";
import { useEffect } from "react";

import { WorkspaceSwitcher } from "../settings/SettingsNavParts";
import { organizationStatus, shouldForgetWorkspaceKeys } from "./activeOrganization.logic";
import { useActiveOrganization, useChosenWorkspace } from "./organizationChoice";
import { usePeerHub } from "./projectScope";

/** The status as Work reads it: the active organization's part of it. */
export function useOrganizationStatus(status: PeerHubStatus | null): PeerHubStatus | null {
  const [chosen] = useChosenWorkspace();
  return status === null ? null : organizationStatus(status, chosen);
}

/**
 * The organization the app works in, named at the top of the sidebar: plain with one membership,
 * a switcher with several. Once nobody is signed in it forgets what named a workspace, however the
 * sign-out happened (this window, another client, an ended session).
 */
export function ActiveOrganization() {
  const { status } = usePeerHub();
  const { chosen, scope, choose, forget } = useActiveOrganization();
  const forgetNow = shouldForgetWorkspaceKeys(status, { workspace: chosen, scope });
  useEffect(() => {
    if (forgetNow) forget();
  }, [forget, forgetNow]);
  const workspaces = status?.signedIn ? status.workspaces : [];
  const active = activeOrganization(workspaces, chosen);
  if (active === null) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-2.5 text-xs text-muted-foreground">
      <Building2Icon aria-hidden className="size-3.5 shrink-0" />
      {workspaces.length > 1 ? (
        <WorkspaceSwitcher workspaces={workspaces} current={active.slug} onSelect={choose} />
      ) : (
        <span className="truncate">{active.name}</span>
      )}
    </div>
  );
}
