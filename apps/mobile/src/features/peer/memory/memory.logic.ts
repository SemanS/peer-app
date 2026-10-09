import { activePlugin, inactivePluginReason } from "@t3tools/client-runtime/peer/plugins";
import type { PeerHubStatus } from "@t3tools/contracts";

export function memoryEnvironmentState(status: Pick<PeerHubStatus, "plugins"> | null) {
  if (status === null) return "loading";
  return activePlugin(status, "memory") ? "active" : inactivePluginReason(status, "memory");
}
export const hasActiveMemory = (statuses: ReadonlyArray<Pick<PeerHubStatus, "plugins"> | null>) =>
  statuses.some((status) => memoryEnvironmentState(status) === "active");
