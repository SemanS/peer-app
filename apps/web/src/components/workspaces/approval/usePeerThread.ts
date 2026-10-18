import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useThreadShells } from "../../../state/entities";
import { usePrimaryEnvironment } from "../../../state/environments";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { projectSignals } from "../ProjectSignals";
import { usePeerPlugins } from "../slots";
import { canWatchThreads } from "../slots.logic";
import { usePeerHubStatus } from "../WorkspaceAccess";
import { buildWorkTree } from "../workTree.logic";
import { approvalSignals } from "./approval.logic";

/**
 * A thread's place in Peer's work, for one of this computer's threads in a Peer workspace project:
 * its project and task, overlaps with the person's agents and held resources. Null elsewhere, or
 * signed out.
 */
export function usePeerThread(threadEnvironmentId: EnvironmentId, threadId: ThreadId | null) {
  const threadKey = threadId === null ? null : `${threadEnvironmentId}:${threadId}`;
  const primary = usePrimaryEnvironment();
  const environmentId =
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null;
  const status = usePeerHubStatus(environmentId);
  const plugins = usePeerPlugins(status);
  const threads = useThreadShells();
  const now = useRelativeTimeTick(60_000);
  if (environmentId === null || status === null || !status.signedIn || threadKey === null) {
    return null;
  }
  const tree = buildWorkTree({
    status,
    localThreads: threads,
    now,
    watch: canWatchThreads(plugins),
  });
  const signals = approvalSignals({
    tree,
    status,
    threadKey,
    signals: (project) => projectSignals(status, project, plugins),
  });
  return signals === null ? null : { environmentId, status, plugins, signals };
}
