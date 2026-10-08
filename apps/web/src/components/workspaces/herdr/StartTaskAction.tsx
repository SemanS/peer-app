import type { TaskSlotProps } from "../slots.types";
import { taskLabel } from "../workTree.logic";
import { StartTaskAgent } from "./StartTaskAgent";

/** The play button on an open task's row: start an agent on it. */
export function StartTaskAction({
  environmentId,
  status,
  workspace,
  project,
  task,
}: TaskSlotProps) {
  if (task.done || project === undefined) return null;
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
