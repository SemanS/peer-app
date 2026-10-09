import {
  needsYouNotice,
  needsYouCardCopy,
  shouldShowHomeRow,
  alertsRowState,
  requestActionState,
  overlapActionAvailability,
  needsYouTickNeeded,
  type NeedsYouEnvironment,
} from "@t3tools/client-runtime/peer/needs-you";
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
