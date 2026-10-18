import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";

/**
 * A project's changes as the person's environment keeps them: a view on subscribe, then again each
 * time the Hub or this computer moves them. Pages and task sections of one project share the one
 * subscription. `error` is only what failed before any view arrived.
 */
export function useProjectChanges(input: {
  readonly environmentId: EnvironmentId | null;
  readonly workspace: string;
  readonly project: string;
}) {
  const { environmentId, workspace, project } = input;
  const live = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.peerChangesLive({ environmentId, input: { workspace, project } }),
  );
  const view = live.data ?? undefined;
  return { view, error: view === undefined ? live.error : null };
}
