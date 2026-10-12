import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { InlineButton } from "../../ui/button";
import { PeerSectionLabel } from "../PeerPageHeader";
import { useCoordinationRefresh } from "../SharedInputs";
import { activityRows } from "./taskActivity.logic";

/**
 * What lately happened on the task, from the Hub's coordination history of it (the history the
 * review page and the task context page read): the last few things that moved the task, with the
 * rest of the history behind "All activity".
 */
export function TaskActivity({
  environmentId,
  status,
  workspace,
  project,
  task,
  area,
  created,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
  readonly area: string | null;
  readonly created: { readonly by: string; readonly at: string } | undefined;
  readonly now: number;
}) {
  const [all, setAll] = useState(false);
  const history = useEnvironmentQuery(
    serverEnvironment.peerHubCoordEvents({
      environmentId,
      input: { workspace, project, task, limit: 50 },
    }),
  );
  useCoordinationRefresh(history.refresh);
  const { rows, expandable } = activityRows({
    events: history.data ?? [],
    status,
    workspace,
    created: created === undefined ? undefined : { ...created, area },
    now,
    all,
  });
  return (
    <section aria-label="Activity" className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <PeerSectionLabel>Activity</PeerSectionLabel>
        <span className="flex-1" />
        {expandable || all ? (
          <InlineButton
            tone="muted"
            className="text-xs"
            aria-expanded={all}
            onClick={() => setAll((value) => !value)}
          >
            {all ? "Fewer" : "All activity"}
          </InlineButton>
        ) : null}
      </div>
      {history.error === null ? null : (
        <p role="alert" className="text-sm text-muted-foreground">
          {history.error}
        </p>
      )}
      {history.data === null && history.error === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has happened on this task yet.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((row) => (
            <li key={row.id} className="flex min-h-10 items-baseline gap-3 px-4 py-2.5">
              <time dateTime={row.at} className="w-16 shrink-0 text-xs text-muted-foreground">
                {row.when}
              </time>
              <span className="min-w-0 flex-1 text-sm text-foreground">{row.what}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
