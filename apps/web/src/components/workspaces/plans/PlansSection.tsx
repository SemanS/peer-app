import { plansSectionEmpty, plansSectionModel } from "@t3tools/client-runtime/peer/plans-view";

import { Button } from "../../ui/button";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { PeerSectionLabel } from "../PeerPageHeader";
import type { TaskContextSlotProps } from "../slots.types";
import { PlanCards } from "./PlanCards";
import { usePlansView } from "./usePlansView";

const TASK_SCOPE = "task:";

/**
 * Plans on a task's context page: what the agents on the task said they will change, use and
 * provide, where that meets other work, and the challenges agents made of what it meets. Advice
 * people read, never edit: the section has no control that changes a plan or opens or closes a
 * challenge, and neither adds anything to Needs you. It is absent while Plans is
 * off, not served by the Hub, or the page is the project's shared context rather than a task's.
 */
export function PlansSection({
  environmentId,
  status,
  workspace,
  project,
  scope,
}: TaskContextSlotProps) {
  const task = scope.startsWith(TASK_SCOPE) ? scope.slice(TASK_SCOPE.length) : undefined;
  const { active, view, error, refresh } = usePlansView({
    environmentId,
    status,
    workspace,
    project,
    task,
  });
  const now = useRelativeTimeTick(30_000);
  if (!active || task === undefined) return null;
  const model =
    view === undefined
      ? undefined
      : plansSectionModel({ status, workspace, project, task, view, now });
  return (
    <section aria-label="Plans" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <PeerSectionLabel>Plans</PeerSectionLabel>
        <p className="text-sm text-muted-foreground">
          What this task’s agents said they will change, use and provide, and where that meets other
          work. Advice only: nothing here stops an edit.
        </p>
      </div>
      {error === null ? null : (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-sm text-destructive-foreground"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}
      {model === undefined ? (
        error === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading plans…
          </p>
        ) : null
      ) : plansSectionEmpty(model) ? (
        <p className="text-sm text-muted-foreground">No agent on this task has declared a plan.</p>
      ) : (
        <PlanCards model={model} workspace={workspace} project={project} />
      )}
    </section>
  );
}
