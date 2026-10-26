/**
 * The organization the app works in (a Hub workspace). With one membership it is that one; with
 * several the person picks one in the sidebar, and Work and Settings follow the choice, which is
 * kept with Settings' last workspace (`peer:settings-workspace`).
 */
import { activeOrganization } from "@t3tools/client-runtime/peer-organizations";
import { PEER_LOCAL_WORKSPACE, type PeerHubStatus } from "@t3tools/contracts";

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

/** The workspace a Work scope names: `<workspace>/<project>`; none for all or a local project. */
const scopeWorkspace = (scope: string): string | null =>
  scope === ALL_PROJECTS || isLocalScope(scope) ? null : (scope.split("/")[0] ?? null);

/**
 * Which stored keys name a workspace the person may not see: every one once nobody is signed in,
 * else those naming a workspace they are not a member of (a stale choice from another person, or
 * a workspace they left).
 */
export function staleWorkspaceKeys(
  status:
    | (Pick<PeerHubStatus, "signedIn"> & {
        readonly workspaces: ReadonlyArray<{ readonly slug: string }>;
      })
    | null,
  stored: { readonly workspace: string | null; readonly scope: string },
): { readonly workspace: boolean; readonly scope: boolean } {
  if (status === null) return { workspace: false, scope: false };
  const member = (slug: string | null) =>
    slug === null || (status.signedIn && status.workspaces.some((w) => w.slug === slug));
  return { workspace: !member(stored.workspace), scope: !member(scopeWorkspace(stored.scope)) };
}

/**
 * Whether the main pane must leave a route that names `routeWorkspace`: the person is no member
 * of it, or they just switched the active organization away from it. Peer's local coordination
 * (`@local`) belongs to no organization.
 */
export function leavesRoute(input: {
  readonly routeWorkspace: string | null;
  readonly memberships: ReadonlyArray<string>;
  readonly active: string | null;
  readonly previousActive: string | null;
}): boolean {
  const { routeWorkspace, active, previousActive } = input;
  if (routeWorkspace === null || routeWorkspace === PEER_LOCAL_WORKSPACE) return false;
  if (!input.memberships.includes(routeWorkspace)) return true;
  return previousActive !== null && previousActive !== active && routeWorkspace !== active;
}
