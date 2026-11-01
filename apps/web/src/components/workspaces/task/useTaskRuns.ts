import type { EnvironmentId, PeerRun } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";

const NO_RUNS: ReadonlyArray<PeerRun> = [];

/**
 * A task's runs from the Hub, read when the page opens and again whenever `revision` (what the
 * live work view says about the task) changes, so a run another computer started or ended shows
 * without a timer polling the Hub.
 */
export function useTaskRuns(input: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly revision: string;
}) {
  const { environmentId, workspace, projectId, taskId, revision } = input;
  const query = useEnvironmentQuery(
    serverEnvironment.peerRunsList({ environmentId, input: { workspace, projectId, taskId } }),
  );
  const { refresh } = query;
  // The query reads on mount; only a later change of the work view reads again.
  const seen = useRef(revision);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Refetches from the Hub when the live work view moves.
  useEffect(() => {
    if (revision === seen.current) return;
    seen.current = revision;
    refresh();
  }, [refresh, revision]);
  return {
    runs: query.data?.runs ?? NO_RUNS,
    loading: query.data === null && query.error === null,
    error: query.error,
    refresh,
  };
}
