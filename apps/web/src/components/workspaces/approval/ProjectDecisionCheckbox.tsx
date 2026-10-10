import type { EnvironmentId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";

import { Badge } from "../../ui/badge";
import { Checkbox } from "../../ui/checkbox";
import { useProjectDecisions } from "./projectDecision";
import { usePeerThread } from "./usePeerThread";

/**
 * Under an agent's question in a Peer workspace project with Knowledge on: the person may mark the
 * answer as a project decision, which asks the agent to record it marked [project] so it reaches
 * Knowledge to keep.
 */
export function ProjectDecisionCheckbox({
  environmentId,
  threadId,
  requestId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly requestId: RuntimeRequestId;
}) {
  const peer = usePeerThread(environmentId, threadId);
  const marked = useProjectDecisions((state) => state.marked[requestId] === true);
  const mark = useProjectDecisions((state) => state.mark);
  if (peer === null || !peer.plugins.some((plugin) => plugin.id === "knowledge")) return null;
  return (
    <label className="mt-2.5 flex items-center gap-2 px-2.5 text-xs text-foreground">
      <Checkbox checked={marked} onCheckedChange={(checked) => mark(requestId, checked)} />
      Mark this as a project decision
      <Badge variant="knowledge" size="sm">
        Knowledge to keep
      </Badge>
    </label>
  );
}
