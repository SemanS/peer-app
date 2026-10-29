import type { TaskSlotProps } from "../slots.types";
import { taskLabel } from "../workTree.logic";
import { StartTaskAgent } from "./StartTaskAgent";

/**
 * The play button on an open task's row: start an agent on it. An item nobody decided how to run,
 * and a group, start from their page, which settles the one and gives the other its items.
 */
export function StartTaskAction({
  environmentId,
  status,
  workspace,
  project,
  task,
}: TaskSlotProps) {
  if (task.done || project === undefined || task.unsettled === true || task.executable === false)
    return null;
  return (
    <StartTaskAgent
      environmentId={environmentId}
      workspace={workspace}
      project={project}
      taskId={task.id}
      taskLabel={taskLabel(task)}
      status={status}
    />
  );
}
