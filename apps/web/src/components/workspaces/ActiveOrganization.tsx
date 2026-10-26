import { activeOrganization } from "@t3tools/client-runtime/peer-organizations";
import type { PeerHubStatus } from "@t3tools/contracts";
import { Building2Icon, LogInIcon } from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useSidebar } from "../ui/sidebar";
import { WorkspaceSwitcher } from "../settings/SettingsNavParts";
import { hubSidebarEntry } from "./hubSignIn.logic";
import { openHubSignIn } from "./HubSignInDialog";
import { leavesRoute, organizationStatus, staleWorkspaceKeys } from "./activeOrganization.logic";
import { useActiveOrganization, useChosenWorkspace } from "./organizationChoice";
import { usePeerHub } from "./projectScope";

/** The status as Work reads it: the active organization's part of it. */
export function useOrganizationStatus(status: PeerHubStatus | null): PeerHubStatus | null {
  const [chosen] = useChosenWorkspace();
  return status === null ? null : organizationStatus(status, chosen);
}

/**
 * The organization the app works in, named at the top of the sidebar: plain with one membership,
 * a switcher with several. While nobody is signed in the same line offers the Hub sign-in, and
 * while the person has no organization yet, the choice of one; both open the sign-in dialog. Once nobody is signed in it forgets what named a workspace, however the
 * sign-out happened (this window, another client, an ended session).
 */
export function ActiveOrganization() {
  const { status } = usePeerHub();
  const { isMobile, setOpenMobile } = useSidebar();
  const { chosen, scope, choose, forget } = useActiveOrganization();
  const stale = staleWorkspaceKeys(status, { workspace: chosen, scope });
  const forgetWorkspace = stale.workspace;
  const forgetScope = stale.scope;
  useEffect(() => {
    if (forgetWorkspace || forgetScope) forget({ workspace: forgetWorkspace, scope: forgetScope });
  }, [forget, forgetScope, forgetWorkspace]);
  const workspaces = status?.signedIn ? status.workspaces : [];
  const active = activeOrganization(workspaces, chosen);
  useLeaveOtherOrganizations(
    status?.signedIn ? workspaces.map((workspace) => workspace.slug) : null,
    active?.slug ?? null,
  );
  const entry = hubSidebarEntry(status);
  if (entry !== null) {
    return (
      <button
        type="button"
        className="mx-2 flex min-w-0 items-center gap-2 rounded-lg border border-border bg-accent/40 px-3 py-2 text-start text-sm font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => {
          // The phone's sidebar is a sheet; the dialog opens over the page it leaves.
          if (isMobile) setOpenMobile(false);
          openHubSignIn();
        }}
      >
        <LogInIcon aria-hidden className="size-4 shrink-0" />
        <span className="truncate">
          {entry === "sign-in" ? "Sign in to Peer Hub" : "Choose your organization"}
        </span>
      </button>
    );
  }
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

/**
 * Takes the main pane home to Work when its route names a workspace the person is not in, or
 * the one they just switched away from, so it never says "You are not a member of …" for a
 * choice they made. `memberships` is null until someone is signed in.
 */
function useLeaveOtherOrganizations(
  memberships: ReadonlyArray<string> | null,
  active: string | null,
) {
  const navigate = useNavigate();
  const routeWorkspace = useParams({
    strict: false,
    select: (params) =>
      "workspace" in params && typeof params.workspace === "string" ? params.workspace : null,
  });
  const previous = useRef(active);
  // One string, so the effect runs when the memberships change rather than on every render.
  const members = memberships === null ? null : memberships.join("\n");
  useEffect(() => {
    const previousActive = previous.current;
    previous.current = active;
    if (
      members !== null &&
      leavesRoute({ routeWorkspace, memberships: members.split("\n"), active, previousActive })
    ) {
      void navigate({ to: "/work", search: {}, replace: true });
    }
  }, [active, members, navigate, routeWorkspace]);
}
