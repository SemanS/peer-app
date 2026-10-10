import {
  needsYouNotice,
  needsYouCardCopy,
  shouldShowHomeRow,
  alertsRowState,
  requestActionState,
  overlapActionAvailability,
  needsYouTickNeeded,
  type NeedsYouEnvironment,
  type NeedsYouItem,
} from "@t3tools/client-runtime/peer/needs-you";
import { PEER_REQUEST_REASON_MAX, type PeerHubDismissRequestInput } from "@t3tools/contracts";
export {
  needsYouNotice,
  needsYouCardCopy,
  shouldShowHomeRow,
  alertsRowState,
  requestActionState,
  overlapActionAvailability,
};
export function mergeNeedsYouEnvironments(
  environments: ReadonlyArray<NeedsYouEnvironment>,
  previous: ReadonlyMap<string, NeedsYouEnvironment>,
  now: number,
) {
  const merged = environments.map((environment) => ({
    ...environment,
    status: environment.status ?? previous.get(environment.environmentId)?.status ?? null,
  }));
  return { environments: merged, tickNeeded: needsYouTickNeeded(merged, now) };
}

/**
 * What declining a team request sends: the request, and the person's reason when they wrote one.
 * The sender sees the reason as written; an empty one sends none, as before reasons existed.
 */
export function declineRequestInput(
  item: Pick<Extract<NeedsYouItem, { kind: "request" }>, "workspace" | "request">,
  reason: string,
): PeerHubDismissRequestInput {
  const said = reason.trim().slice(0, PEER_REQUEST_REASON_MAX).trimEnd();
  return {
    workspace: item.workspace,
    projectId: item.request.project,
    requestId: item.request.id,
    ...(said === "" ? {} : { reason: said }),
  };
}
