import { useState } from "react";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { failureMessage } from "../WorkspaceAccess";
import type { TaskContextSlotProps } from "../slots.types";
import {
  candidates,
  cycleSentence,
  dependenciesOf,
  neededBy,
  dependencyName,
  projectDependencyIndex,
  stateWord,
  toggleInput,
} from "./dependencies.logic";
export function DependsOnSection({
  environmentId,
  status,
  workspace,
  project,
  scope,
}: TaskContextSlotProps) {
  const command = useAtomCommand(serverEnvironment.peerDependenciesChange, {
      reportFailure: false,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const value = status.workspaces
      .find((w) => w.slug === workspace)
      ?.projects.find((p) => p.project.id === project),
    snapshot = status.dependencies?.find((s) => s.workspace === workspace);
  if (!scope.startsWith("task:") || !value || !snapshot?.available) return null;
  const task = scope.slice(5),
    index = projectDependencyIndex(value),
    on = dependenciesOf(snapshot, project, task, index),
    needed = neededBy(snapshot, project, task, index),
    choices = candidates(snapshot, project, task, index);
  const toggle = async (id: string, checked: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await command({
        environmentId,
        input: { workspace, projectId: project, taskId: task, ...toggleInput(id, checked) },
      });
      setError(
        result._tag === "Success" && result.value.kind === "cycle"
          ? cycleSentence(result.value.path, index)
          : failureMessage(result),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Depends on</h3>
      {on.length ? (
        on.map(({ task: other, state }) => (
          <div key={other.id} className="flex items-center gap-2 text-sm">
            <span>
              {dependencyName(other)} · {stateWord(state)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void toggle(other.id, true)}
            >
              Remove
            </Button>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">None</p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">Add dependency</summary>
        <div className="space-y-1">
          {choices
            .filter((choice) => !choice.checked)
            .map(({ task: other, state }) => (
              <div key={other.id}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void toggle(other.id, false)}
                >
                  {dependencyName(other)} · {stateWord(state)}
                </Button>
              </div>
            ))}
        </div>
      </details>
      <h3 className="text-sm font-medium">Needed by</h3>
      <p className="text-sm">
        {needed.map(({ task: other }) => dependencyName(other)).join(", ") || "None"}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
