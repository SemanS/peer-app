import { Link } from "@tanstack/react-router";

import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { PeerSectionLabel } from "../PeerPageHeader";
import { TONE_BADGE } from "../signals";
import type { PeerSlotProps, TaskContextSlotProps } from "../slots.types";
import { AgreementWords } from "./AgreementWords";
import { agreementRows, peopleOf, projectTasks, type AgreementRow } from "./agreements.logic";
import { useAgreementActions } from "./useAgreementActions";
import { useAgreementsView } from "./useAgreementsView";

const TASK_SCOPE = "task:";

/**
 * A task's agreements on its context page: each with the other task, who settled it and when, the
 * state in words (a due one says which task landed), what the agents wrote, and what a person may
 * do with it: Close, as handled or not needed, while it is open or due, and Reopen for one a
 * person closed while no task landed. It is absent where the task has none, and on the project's
 * shared context, which is no task's. Agreements are information: nothing here, or in them, stops
 * an edit or a merge.
 */
export function AgreementsSection({
  environmentId,
  status,
  workspace,
  project,
  scope,
}: TaskContextSlotProps) {
  if (!scope.startsWith(TASK_SCOPE)) return null;
  return (
    <TaskAgreements
      environmentId={environmentId}
      status={status}
      workspace={workspace}
      project={project}
      task={scope.slice(TASK_SCOPE.length)}
    />
  );
}

function TaskAgreements({
  environmentId,
  status,
  workspace,
  project,
  task,
}: PeerSlotProps & {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}) {
  const { view, error, refresh } = useAgreementsView({ environmentId, status, workspace, project });
  const now = useRelativeTimeTick(30_000);
  const rows = agreementRows({
    view,
    project,
    task,
    tasks: projectTasks(status, workspace, project),
    people: peopleOf(status, workspace),
    now,
  });
  // Most tasks have none, so there is nothing to say while the view is on its way either.
  if (rows.length === 0 && error === null) return null;
  return (
    <section aria-label="Agreements" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <PeerSectionLabel>Agreements</PeerSectionLabel>
        <p className="text-sm text-muted-foreground">
          What this task’s agents and another task’s agreed when they settled an overlap. A later
          agent on either task hears an open one once; nothing here stops an edit or a merge.
        </p>
      </div>
      {error === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <AgreementItem
            key={row.id}
            environmentId={environmentId}
            workspace={workspace}
            project={project}
            row={row}
            refresh={refresh}
          />
        ))}
      </ul>
    </section>
  );
}

function AgreementItem({
  environmentId,
  workspace,
  project,
  row,
  refresh,
}: {
  readonly environmentId: PeerSlotProps["environmentId"];
  readonly workspace: string;
  readonly project: string;
  readonly row: AgreementRow;
  readonly refresh: () => void;
}) {
  const { busy, error, close, reopen } = useAgreementActions({
    environmentId,
    workspace,
    project,
    id: row.id,
    onChanged: refresh,
  });
  const { other } = row;
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="min-w-0 text-sm font-medium break-words text-foreground">
          {other === undefined ? (
            "Agreement"
          ) : (
            <>
              With{" "}
              {other.known ? (
                <Link
                  to="/task/$workspace/$project/$task"
                  params={{ workspace, project, task: other.id }}
                  className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {other.label}
                </Link>
              ) : (
                other.label
              )}
            </>
          )}
        </span>
        <Badge variant={TONE_BADGE[row.tone]}>{row.state}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{row.settled}</p>
      <AgreementWords words={row.words} />
      {row.canClose ? (
        <div
          role="group"
          aria-label="Close this agreement"
          className="flex flex-wrap items-center gap-1.5"
        >
          <span className="text-xs text-muted-foreground">Close as</span>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void close("handled")}>
            Handled
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => void close("not-needed")}
          >
            Not needed
          </Button>
        </div>
      ) : null}
      {row.canReopen ? (
        <div className="flex">
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void reopen()}>
            Reopen
          </Button>
        </div>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}
    </li>
  );
}
