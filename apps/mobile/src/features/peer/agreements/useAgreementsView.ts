import { agreementsRevision } from "@t3tools/client-runtime/peer/agreements";
import type {
  EnvironmentId,
  PeerAgreement,
  PeerAgreementsView,
  PeerHubStatus,
} from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { withAgreement } from "./agreements.logic";

interface Kept {
  readonly place: string;
  /** The read this was kept from: a newer read replaces it, answers included. */
  readonly read: PeerAgreementsView;
  /** The read with the Hub's answers to the closes and reopens made since. */
  readonly view: PeerAgreementsView;
}

/**
 * The agreements of a project, read from the Hub through the environment, and read again whenever
 * the status field's revision moves. The view last read stays on screen while the next one is on its
 * way, so a change elsewhere does not blank the list. `apply` puts the Hub's answer to a close or a
 * reopen into that view at once; the next read replaces it.
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
  const [kept, setKept] = useState<Kept | undefined>(undefined);
  const read = query.data ?? undefined;
  if (read !== undefined && (kept?.read !== read || kept.place !== place)) {
    setKept({ place, read, view: read });
  }
  const view = kept?.place === place ? kept.view : read;
  const apply = (agreement: PeerAgreement) =>
    setKept((current) =>
      current === undefined
        ? current
        : { ...current, view: withAgreement(current.view, agreement) },
    );
  return { view, error: query.error, refresh: query.refresh, apply };
}
