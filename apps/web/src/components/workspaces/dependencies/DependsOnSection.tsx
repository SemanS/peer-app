import { useState } from "react";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { PeerSectionLabel } from "../PeerPageHeader";
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
import { withFinally } from "~/lib/withFinally";
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
    await withFinally(
      async () => {
        const result = await command({
          environmentId,
          input: { workspace, projectId: project, taskId: task, ...toggleInput(id, checked) },
        });
        setError(
          result._tag === "Success" && result.value.kind === "cycle"
            ? cycleSentence(result.value.path, index)
            : failureMessage(result),
        );
      },
      () => {
        setBusy(false);
      },
    );
  };
  return (
    <section aria-label="Dependencies" className="flex flex-col gap-2.5">
      <PeerSectionLabel>Depends on</PeerSectionLabel>
      {on.length ? (
        on.map(({ task: other, state }) => (
          <div key={other.id} className="flex items-center gap-2 text-sm">
            <span>
              {dependencyName(other)} · {stateWord(state)}
            </span>
            <Button
              variant="ghost"
              size="xs"
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
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Add a dependency
        </summary>
        <div className="flex flex-wrap gap-1.5 pt-2">
          {choices
            .filter((choice) => !choice.checked)
            .map(({ task: other, state }) => (
              <Button
                key={other.id}
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => void toggle(other.id, false)}
              >
                {dependencyName(other)} · {stateWord(state)}
              </Button>
            ))}
        </div>
      </details>
      <PeerSectionLabel>Needed by</PeerSectionLabel>
      <p className="text-sm text-muted-foreground">
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
