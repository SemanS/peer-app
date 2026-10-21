import { useState } from "react";
import { openSpecGoal } from "@t3tools/client-runtime/peer/openspec";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import ChatMarkdown from "../../ChatMarkdown";
import { Button } from "../../ui/button";
import type { TaskPreparationProps, TaskPreparationState } from "../slots.types";

export function OpenSpecPreparation({
  environmentId,
  status,
  workspace,
  project,
  taskId,
  repositoryId,
  children,
}: TaskPreparationProps) {
  const query = useEnvironmentQuery(
    status.email === null
      ? null
      : serverEnvironment.peerOpenSpec.read({
          environmentId,
          person: status.email,
          input: {
            workspace,
            projectId: project.project.id,
            taskId,
            ...(repositoryId === undefined ? {} : { repositoryId }),
          },
        }),
  );
  const [manual, setManual] = useState(false);
  const data = query.data;
  const reason =
    status.email === null
      ? "Sign in to read this task’s OpenSpec source."
      : (query.error ?? (data?.state === "unavailable" ? data.reason : null));
  const ready = query.error === null && !query.isPending && data?.state === "ready" ? data : null;
  const state: TaskPreparationState = manual
    ? {
        state: "ready",
        prompt: "",
        repositoryId:
          repositoryId ?? project.repositories.find((repo) => repo.state === "ready")?.id ?? "",
      }
    : (ready ?? (reason === null ? { state: "loading" } : { state: "unavailable", reason }));
  const content = (
    <section aria-label="Task preparation" className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <h2 className="text-lg font-medium">Task brief</h2>
        {ready === null ? (
          reason === null ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading the current OpenSpec change…
            </p>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm text-muted-foreground">
                {reason}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={query.isPending}
                  onClick={query.refresh}
                >
                  Retry
                </Button>
                {manual || children === undefined ? null : (
                  <Button variant="ghost" size="sm" onClick={() => setManual(true)}>
                    Write a prompt manually
                  </Button>
                )}
              </div>
            </div>
          )
        ) : (
          <>
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
              {openSpecGoal(ready.proposal)}
            </p>
            <details className="border-t border-border/60 pt-3">
              <summary className="cursor-pointer text-sm font-medium">Full proposal</summary>
              <div className="flex flex-col gap-3 pt-4">
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {ready.sourcePath}
                </p>
                <ChatMarkdown text={ready.proposal} cwd={undefined} />
              </div>
            </details>
            <details className="border-t border-border/60 pt-3">
              <summary className="cursor-pointer text-sm font-medium">
                Checklist · {ready.completed}/{ready.total} complete
              </summary>
              <div className="pt-4">
                <ChatMarkdown text={ready.tasks} cwd={undefined} />
              </div>
            </details>
            {ready.design === null ? null : (
              <details className="border-t border-border/60 pt-3">
                <summary className="cursor-pointer text-sm font-medium">Design</summary>
                <div className="pt-4">
                  <ChatMarkdown text={ready.design} cwd={undefined} />
                </div>
              </details>
            )}
          </>
        )}
        {manual ? (
          <p role="status" className="text-sm text-muted-foreground">
            Using your manual prompt. The OpenSpec source has not supplied these instructions.
          </p>
        ) : null}
      </div>
    </section>
  );
  return children === undefined ? content : children({ ...state, content });
}
