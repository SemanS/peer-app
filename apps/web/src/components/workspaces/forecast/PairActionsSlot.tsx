import type { EnvironmentId, PeerForecastPair, PeerHubStatus } from "@t3tools/contracts";
import { usePeerPlugins } from "../slots";

/**
 * Where other plugins put their actions on a pair's card ("Build ORD-12 on ORD-11", "Resolve
 * together…"). Forecast only offers the slot: it does not know which computer an agent runs on.
 */
export function PairActionsSlot({
  environmentId,
  status,
  workspace,
  project,
  pair,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: string;
  readonly pair: PeerForecastPair;
}) {
  const plugins = usePeerPlugins(status);
  const state = status.workspaces
    .find((entry) => entry.slug === workspace)
    ?.projects.find((entry) => entry.project.id === project);
  return (
    <>
      {plugins.map(({ id, pairActions: Actions }) =>
        Actions === undefined ? null : (
          <Actions
            key={id}
            environmentId={environmentId}
            status={status}
            workspace={workspace}
            project={state}
            pair={pair}
          />
        ),
      )}
    </>
  );
}
