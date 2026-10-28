import { orderedReports, testReportsRevision } from "@t3tools/client-runtime/peer/test-reports";
import type { EnvironmentId, PeerHubStatus, PeerTestReport } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";

/**
 * A task's reports, read from the Hub through the environment while its page is open and again
 * whenever the status's summaries for the task move (a report filed, replaced or removed, an item
 * given an owner). What was read last stays on screen while the next read is on its way.
 */
export function useTestReports(input: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}) {
  const { environmentId, status, workspace, project, task } = input;
  const place = { workspace, project, task };
  const query = useEnvironmentQuery(
    serverEnvironment.peerTestsList({
      environmentId,
      input: place,
      revision: testReportsRevision(status, place),
    }),
  );
  const key = `${environmentId}/${workspace}/${project}/${task}`;
  const [kept, setKept] = useState<
    { readonly key: string; readonly reports: ReadonlyArray<PeerTestReport> } | undefined
  >(undefined);
  const read = query.data ?? undefined;
  if (read !== undefined && (kept?.reports !== read || kept.key !== key)) {
    setKept({ key, reports: read });
  }
  const reports = read ?? (kept?.key === key ? kept.reports : undefined);
  return {
    reports: reports === undefined ? undefined : orderedReports(reports),
    error: query.error,
    refresh: query.refresh,
  };
}
