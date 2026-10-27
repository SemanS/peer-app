import { canStartReview, reviewHarness } from "@t3tools/client-runtime/peer/roles";
import type { PeerRolesStartReviewInput } from "@t3tools/contracts";

import type { TaskSlotProps } from "../slots.types";
import { taskLabel } from "../workTree.logic";

/** A review to start on a task: what the Hub is asked, and how the task is named in feedback. */
export interface ReviewLaunch {
  readonly input: PeerRolesStartReviewInput;
  readonly label: string;
}

/**
 * The review Start a review would start on a task, or null where none is offered: the plugin is
 * inactive, the task is done, or no checkout of the project is ready here. It runs in the
 * repository the launcher picks first and in the harness the task was last built in.
 */
export function reviewLaunch(
  props: Pick<TaskSlotProps, "status" | "workspace" | "project" | "task">,
): ReviewLaunch | null {
  const { project, task } = props;
  if (project === undefined || !canStartReview(props.status, task)) return null;
  const repository = project.repositories.find((repo) => repo.state === "ready");
  if (repository === undefined) return null;
  return {
    input: {
      workspace: props.workspace,
      projectId: project.project.id,
      taskId: task.id,
      repositoryId: repository.id,
      harness: reviewHarness(task.threads),
    },
    label: taskLabel(task),
  };
}
