import { agreementsRevision } from "@t3tools/client-runtime/peer/agreements";
import type { EnvironmentId, PeerAgreementsView, PeerHubStatus } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";

/**
 * A project's agreements, read from the Hub through the environment while a card or a task's page
 * is open, and read again whenever the status field's revision moves (an agreement opened, closed or
 * fell due for the person). The view last read for the project stays on screen while the next one is
 * on its way, so a change elsewhere does not blank what the person is reading.
 */
export function useAgreementsView(input: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: string;
}) {
  const { environmentId, status, workspace, project } = input;
  const query = useEnvironmentQuery(
    serverEnvironment.peerAgreementsView({
      environmentId,
      input: { workspace, project },
      revision: agreementsRevision(status.agreements, workspace),
    }),
  );
  const place = `${environmentId}/${workspace}/${project}`;
  const [kept, setKept] = useState<
    { readonly place: string; readonly view: PeerAgreementsView } | undefined
  >(undefined);
  const read = query.data ?? undefined;
  if (read !== undefined && (kept?.view !== read || kept.place !== place)) {
    setKept({ place, view: read });
  }
  const view = read ?? (kept?.place === place ? kept.view : undefined);
  return { view, error: query.error, refresh: query.refresh };
}
