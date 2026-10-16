import { useAtomValue } from "@effect/atom-react";
import type { PeerHubStatus } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo } from "react";

import { usePrimaryEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import {
  chatScopeKeys,
  peerProjectIndex,
  resolveProjectScope,
  type PeerProjectEntry,
  type ScopeGroup,
} from "./projectScope.logic";
import { usePeerHubStatus } from "./WorkspaceAccess";
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
  return useMemo(() => JSON.parse(digest) as ReadonlyArray<PeerProjectEntry>, [digest]);
}

/**
 * The one project scope of the Tasks and Chats views (`peer:work-scope`) against the projects there
 * are: its name, the projects whose chats it keeps (`keys`, null for every project), and how to
 * change it. `groups` is the sidebar's project catalog, which says what a local project is.
 */
export function useProjectScope(groups: ReadonlyArray<ScopeGroup>) {
  const [stored, setScope] = useWorkScope();
  const peer = usePeerProjectIndex();
  const resolved = useMemo(
    () => resolveProjectScope(stored, { peer, groups }),
    [groups, peer, stored],
  );
  const { refs } = resolved;
  // Keyed by the refs, which only change with the projects, not with every thread update.
  const keys = useMemo(() => chatScopeKeys(refs), [refs]);
  return { ...resolved, keys, peer, setScope };
}
