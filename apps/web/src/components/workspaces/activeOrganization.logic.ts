/**
 * The organization the app works in (a Hub workspace). With one membership it is that one; with
 * several the person picks one in the sidebar, and Work and Settings follow the choice, which is
 * kept with Settings' last workspace (`peer:settings-workspace`).
 */
import { activeOrganization } from "@t3tools/client-runtime/peer-organizations";
import type { PeerHubStatus } from "@t3tools/contracts";

import { isLocalScope } from "./projectScope.logic";
import { ALL_PROJECTS } from "./workBoard.logic";

/**
 * The status as Work reads it: only the active organization's workspace, so its tasks, projects
 * and what waits on the person are that organization's. Nothing to narrow with one membership.
 */
export function organizationStatus<
  S extends { readonly workspaces: ReadonlyArray<{ readonly slug: string }> },
>(status: S, chosen: string | null): S {
  if (status.workspaces.length <= 1) return status;
  const active = activeOrganization(status.workspaces, chosen);
  return active === null
    ? status
    : { ...status, workspaces: status.workspaces.filter((w) => w.slug === active.slug) };
}

/**
 * Where Work's project scope goes when the person switches to `slug`: a project of another
 * organization gives way to all of the new one's; all projects and this computer's own stay.
 */
export function scopeAfterSwitch(scope: string, slug: string): string {
  if (scope === ALL_PROJECTS || isLocalScope(scope) || scope.startsWith(`${slug}/`)) return scope;
  return ALL_PROJECTS;
}

/**
 * Whether the keys that name a workspace should be forgotten: the environment answered and nobody
 * is signed in, yet one of them still names something.
 */
export function shouldForgetWorkspaceKeys(
  status: Pick<PeerHubStatus, "signedIn"> | null,
  stored: { readonly workspace: string | null; readonly scope: string },
): boolean {
  if (status === null || status.signedIn) return false;
  return (
    stored.workspace !== null || (stored.scope !== ALL_PROJECTS && !isLocalScope(stored.scope))
  );
}
