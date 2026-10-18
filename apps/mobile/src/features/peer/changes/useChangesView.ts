import type { EnvironmentId, ProjectChanges } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../../state/query";
import { peerChanges } from "./changesAtoms";

/**
 * A project's changes as the person's environment keeps them: a view on subscribe, then each time
 * the Hub or that computer moves them. `enabled` false reads nothing (jj cannot read the checkout,
 * so there is no view to wait for).
 */
export function useChangesView(input: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly enabled: boolean;
}): {
  readonly view: ProjectChanges | undefined;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const query = useEnvironmentQuery(
    input.enabled
      ? peerChanges.peerChangesLive({
          environmentId: input.environmentId,
          input: { workspace: input.workspace, project: input.project },
        })
      : null,
  );
  return { view: query.data ?? undefined, error: query.error, refresh: query.refresh };
}
