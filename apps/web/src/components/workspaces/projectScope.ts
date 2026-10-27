import { useLocation, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";
import {
  locationForProjectScope,
  pullRequestsLocation,
  scopeForLocation,
} from "./projectScopeNavigation.logic";
import { useAtomValue } from "@effect/atom-react";
import type { PeerHubStatus } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { usePrimaryEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import {
  chatScopeKeys,
  peerProjectIndex,
  resolveProjectScope,
  scopeOfProject,
  type PeerProjectEntry,
  type ScopeGroup,
} from "./projectScope.logic";
import { usePeerHubStatus } from "./WorkspaceAccess";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { useThreadShell } from "../../state/entities";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { useChosenWorkspace } from "./organizationChoice";
import { useWorkScope } from "./workScope";

const NO_STATUS = Atom.make(AsyncResult.initial<PeerHubStatus, never>(false)).pipe(
  Atom.withLabel("peer-hub:none"),
);

/** The index as a string, so the sidebar re-renders when the projects change, not with every status. */
const selectIndexDigest = (result: AsyncResult.AsyncResult<PeerHubStatus, unknown>): string =>
  JSON.stringify(peerProjectIndex(Option.getOrNull(AsyncResult.value(result))));

/** The environment the Hub's status comes from: this computer's, while it is connected. */
function useHubEnvironmentId() {
  const primary = usePrimaryEnvironment();
  return primary !== null && primary.connection.phase === "connected"
    ? primary.environmentId
    : null;
}

/** This computer's connected Peer environment and the Hub's status as it reads it. */
export function usePeerHub() {
  const environmentId = useHubEnvironmentId();
  return { environmentId, status: usePeerHubStatus(environmentId) };
}

/**
 * The workspace projects and where their repositories are open on this computer. The sidebar's
 * root reads this instead of the Hub's whole status: the status changes with every sync and
 * presence update, which would re-render the whole thread list for nothing.
 */
function usePeerProjectIndex(): ReadonlyArray<PeerProjectEntry> {
  const environmentId = useHubEnvironmentId();
  const digest = useAtomValue(
    environmentId === null
      ? NO_STATUS
      : serverEnvironment.peerHubLive({ environmentId, input: {} }),
    selectIndexDigest,
  );
  return JSON.parse(digest) as ReadonlyArray<PeerProjectEntry>;
}

/**
 * The one project scope of the Tasks and Chats views (`peer:work-scope`) against the projects there
 * are: its name, the projects whose chats it keeps (`keys`, null for every project), and how to
 * change it. `groups` is the sidebar's project catalog, which says what a local project is.
 */
export function useProjectScope(groups: ReadonlyArray<ScopeGroup>) {
  const [stored, setStored] = useWorkScope();
  const navigate = useNavigate();
  const peer = usePeerProjectIndex();
  const [chosenWorkspace, setChosenWorkspace] = useChosenWorkspace();
  const location = useLocation();
  const params = useParams({ strict: false });
  const thread = useThreadShell(useThreadRouteRef());
  const threadScope = thread === null ? undefined : scopeOfProject(thread, { peer, groups })?.scope;
  const routeScope = scopeForLocation(location.pathname, params, location.search, { peer, groups });
  const workspaceOf = (scope: string | undefined) =>
    peer.find((entry) => entry.scope === scope)?.scope.split("/")[0];
  const routeWorkspace = workspaceOf(routeScope);
  const threadWorkspace = workspaceOf(threadScope);
  const rememberScope = useEffectEvent(
    (next: string | undefined, workspace: string | undefined) => {
      if (next !== undefined && next !== stored) setStored(next);
      // A direct link or Back can return to a different organization's project.
      if (workspace !== undefined && workspace !== chosenWorkspace) setChosenWorkspace(workspace);
    },
  );
  useEffect(() => {
    rememberScope(routeScope, routeWorkspace);
  }, [routeScope, routeWorkspace]);
  useEffect(() => {
    rememberScope(threadScope, threadWorkspace);
  }, [threadScope, threadWorkspace]);
  const setScope = (value: string) => {
    const next = resolveProjectScope(value, { peer, groups });
    setStored(next.scope);
    void navigate(locationForProjectScope(location.pathname, location.search, next));
  };
  const resolved = resolveProjectScope(routeScope ?? stored, { peer, groups });
  const keys = chatScopeKeys(resolved.refs);
  return { ...resolved, requestedScope: routeScope ?? stored, keys, peer, setScope };
}

/** Preserve the saved choice in history even before the project catalogs have arrived. */
export function useWorkScopeUrl(requestedScope: string) {
  const { scope, view } = useSearch({ from: "/_chat/work" });
  const navigate = useNavigate();
  useEffect(() => {
    if (scope === undefined) {
      void navigate({
        to: "/work",
        search: { ...(view ? { view } : {}), scope: requestedScope },
        replace: true,
      });
    }
  }, [navigate, scope, requestedScope, view]);
}

export function useOpenProjectPullRequests() {
  const scope = useProjectScope(useSidebarProjectGroups());
  const navigate = useNavigate();
  return () => navigate(pullRequestsLocation({ ...readPullRequestListPreferences() }, scope));
}
