import { useAtomValue } from "@effect/atom-react";
import type { PeerHubStatus } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { usePrimaryEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { peerProjectIndex, type PeerProjectEntry } from "./projectScope.logic";

const NO_STATUS = Atom.make(AsyncResult.initial<PeerHubStatus, never>(false)).pipe(
  Atom.withLabel("peer-hub:none"),
);

/** The index as a string, so the sidebar re-renders when the projects change, not with every status. */
const selectIndexDigest = (result: AsyncResult.AsyncResult<PeerHubStatus, unknown>): string =>
  JSON.stringify(peerProjectIndex(Option.getOrNull(AsyncResult.value(result))));

/**
 * The workspace projects and where their repositories are open on this computer. The sidebar's
 * root reads this instead of the Hub's whole status: the status changes with every sync and
 * presence update, which would re-render the whole thread list for nothing.
 */
export function usePeerProjectIndex(): ReadonlyArray<PeerProjectEntry> {
  const primary = usePrimaryEnvironment();
  const environmentId =
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null;
  const digest = useAtomValue(
    environmentId === null
      ? NO_STATUS
      : serverEnvironment.peerHubLive({ environmentId, input: {} }),
    selectIndexDigest,
  );
  return useMemo(() => JSON.parse(digest) as ReadonlyArray<PeerProjectEntry>, [digest]);
}
