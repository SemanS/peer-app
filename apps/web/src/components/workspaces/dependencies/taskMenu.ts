import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "../../../rpc/atomRegistry";
import { serverEnvironment } from "../../../state/server";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { reportFailure } from "../workFeedback";
import type { TaskMenuEntry, TaskSlotProps } from "../slots.types";
import {
  candidates,
  cycleSentence,
  dependencyName,
  projectDependencyIndex,
  stateWord,
  toggleInput,
} from "./dependencies.logic";
const pending = new Set<string>();
export function taskMenu(props: TaskSlotProps): ReadonlyArray<TaskMenuEntry> {
  if (!props.project) return [];
  const { workspace, environmentId, status, task, project } = props,
    snapshot = status.dependencies?.find((s) => s.workspace === workspace);
  if (!snapshot?.available) return [];
  const index = projectDependencyIndex(project),
    choices = candidates(snapshot, project.project.id, task.id, index),
    key = `${environmentId}:${workspace}:${project.project.id}:${task.id}`;
  return [
    {
      item: {
        id: "dependencies",
        label: "Depends on",
        children: choices.map(({ task: other, state, checked }) => ({
          id: `depends:${other.id}`,
          label: `${dependencyName(other)} · ${stateWord(state)}`,
          checked,
          disabled: pending.has(key),
        })),
      },
      run: (choice) => {
        const found = choices.find(({ task: other }) => choice === `depends:${other.id}`);
        if (!found || pending.has(key)) return;
        pending.add(key);
        void runAtomCommand(
          appAtomRegistry,
          serverEnvironment.peerDependenciesChange,
          {
            environmentId,
            input: {
              workspace,
              projectId: project.project.id,
              taskId: task.id,
              ...toggleInput(found.task.id, found.checked),
            },
          },
          { reportFailure: false },
        )
          .then((result) => {
            if (!reportFailure("Could not change dependencies", result)) return;
            if (result._tag === "Success" && result.value.kind === "cycle")
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not change dependencies",
                  description: cycleSentence(result.value.path, index),
                }),
              );
          })
          .finally(() => pending.delete(key));
      },
    },
  ];
}
