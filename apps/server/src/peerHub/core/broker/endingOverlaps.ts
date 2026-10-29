/**
 * What an ending session leaves open: its overlaps as the merged view has them, for the plugins
 * that hear of its end.
 *
 * @module peerHub/core/broker/endingOverlaps
 */
import { policyOfDecision, policyWithoutHub } from "../coordination/edits.ts";
import { closerOf } from "../coordination/news.ts";
import type { PeerEndingOverlap } from "../plugin.ts";
import type { CoordinationBroker } from "./Broker.ts";
import type { LocalSession } from "./sessions.ts";

/**
 * The session's open overlaps as the merged view has them before core lets it go, so the closer
 * is the one chosen while it was still at work.
 */
export function endingOverlaps(
  broker: CoordinationBroker,
  session: LocalSession,
): ReadonlyArray<PeerEndingOverlap> {
  const view = broker.views.get(session.workspace);
  const merged = broker.merged(session.workspace, view);
  return merged.overlaps.flatMap((overlap) =>
    overlap.state !== "open" || !overlap.sessions.includes(session.id)
      ? []
      : [
          {
            id: overlap.id,
            workspace: session.workspace,
            project: overlap.project,
            files: overlap.files,
            sessions: overlap.sessions,
            notes: overlap.notes,
            policy: policyOfDecision(
              overlap.decision,
              policyWithoutHub(view?.policies, overlap.project, broker.host.policy()),
            ),
            closer: closerOf(overlap, merged.sessions),
          },
        ],
  );
}
