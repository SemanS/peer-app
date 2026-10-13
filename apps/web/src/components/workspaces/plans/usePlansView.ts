import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import type { EnvironmentId, PeerHubStatus, PeerPlansView } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";

/**
 * The view of a task's plans, while Plans is active: read from the Hub through the environment,
 * and read again whenever the status field's revision moves. The view last read for the task stays
 * on screen while the next one is on its way, so a change elsewhere does not blank the section.
 */
export function usePlansView(input: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: string;
  /** Undefined for a page that is not a task's, which reads no plans. */
  readonly task: string | undefined;
}) {
  const { environmentId, status, workspace, project, task } = input;
  const active = task !== undefined && activePlugin(status, "plans");
  const query = useEnvironmentQuery(
    active
      ? serverEnvironment.peerPlansList({
          environmentId,
          input: { workspace, project, task, revision: status.plans?.revision },
        })
      : null,
  );
  const place = `${environmentId}/${workspace}/${project}/${task}`;
  const [kept, setKept] = useState<{ place: string; view: PeerPlansView } | undefined>(undefined);
  const read = query.data ?? undefined;
  if (read !== undefined && (kept?.view !== read || kept.place !== place)) {
    setKept({ place, view: read });
  }
  const view = read ?? (kept?.place === place ? kept.view : undefined);
  return { active, view, error: query.error, refresh: query.refresh };
}
