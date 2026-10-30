import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";

/** A workspace's invitations; null from a Hub that does not list them. */
export function useInvitations(environmentId: EnvironmentId, workspace: string) {
  return useEnvironmentQuery(
    serverEnvironment.peerHubInvitations({ environmentId, input: { workspace } }),
  );
}
