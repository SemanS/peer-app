import { useState } from "react";
import type { PeerImpactPlace } from "@t3tools/contracts";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import {
  impactAction,
  impactChangeLabel,
  impactRows,
  impactProjectIds,
  impactPlaceAllowed,
  filterImpactView,
  visibleImpactProvided,
  visibleImpactRecords,
} from "@t3tools/client-runtime/peer/impact";
import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import { serverEnvironment } from "../../../state/server";
import { useEnvironmentQuery } from "../../../state/query";
import { useEnvironmentSessionState } from "../../../state/session";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { failureMessage } from "../WorkspaceAccess";
import type { PeerSlotProps } from "../slots.types";

export function ImpactList({
  environmentId,
  status,
  place,
  provided = false,
}: PeerSlotProps & {
  place: PeerImpactPlace;
  provided?: boolean;
}) {
  const projectIds = impactProjectIds(status.workspaces, place.workspace),
    active = activePlugin(status, "impact") && impactPlaceAllowed(projectIds, place),
    session = useEnvironmentSessionState(environmentId),
    operate =
      !session.hasError &&
      session.data?.authenticated === true &&
      session.data.scopes?.includes(AuthOrchestrationOperateScope) === true;
  const query = useEnvironmentQuery(
    active && status.email
      ? serverEnvironment.peerImpactList({
          environmentId,
          person: status.email,
          projectIds,
          input: { ...place, revision: status.impact?.revision },
        })
      : null,
  );
  const dismiss = useAtomCommand(serverEnvironment.peerImpactDismiss, { reportFailure: false }),
    reopen = useAtomCommand(serverEnvironment.peerImpactReopen, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const view =
      query.error || query.isPending || !query.data
        ? undefined
        : filterImpactView(query.data, projectIds),
    records = visibleImpactRecords(view, place),
    changes = provided ? visibleImpactProvided(view, place) : [];
  if (!active) return null;
  async function change(record: (typeof records)[number]) {
    const action = impactAction(record, operate);
    if (!action || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await (action.command === "dismiss" ? dismiss : reopen)({
        environmentId,
        input: { workspace: place.workspace, project: record.project, id: record.id },
      });
      setError(failureMessage(result));
      query.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      {query.isPending ? <p className="text-xs">Loading impact overlaps…</p> : null}
      {query.error ? (
        <div role="alert">
          <p>{query.error}</p>
          <Button variant="ghost" size="sm" onClick={query.refresh}>
            Retry
          </Button>
        </div>
      ) : null}
      {records.map((record) => {
        const action = impactAction(record, operate);
        return (
          <details key={record.id}>
            <summary className="cursor-pointer text-xs">
              {record.sides.map((side) => `${side.label} · ${side.email}`).join(" ↔ ")}
              {` · ${record.state}${record.reopened ? " · reopened" : ""}`}
            </summary>
            <div className="space-y-2 py-2">
              <p className="text-xs text-muted-foreground">
                {record.project} · {place.workspace}
              </p>
              {impactRows(record).map(({ item, label }) => (
                <p
                  key={JSON.stringify([item.changer, item.path, item.name])}
                  className="break-words text-xs"
                >
                  {label} {impactChangeLabel(item.change)}.
                  {item.from.length
                    ? ` Calls from ${item.from.map((from) => `${from.name} (${from.path})`).join(", ")}.`
                    : ""}
                </p>
              ))}
              {record.dismissedBy && record.state === "dismissed" ? (
                <p className="text-xs text-muted-foreground">Dismissed by {record.dismissedBy}.</p>
              ) : null}
              {action ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void change(record)}
                >
                  {action.label}
                </Button>
              ) : null}
            </div>
          </details>
        );
      })}
      {changes.length ? (
        <div className="space-y-1">
          <h4 className="text-xs font-medium">Changed provided interfaces</h4>
          {changes.map((item) => (
            <p
              key={`${item.side.session}/${item.path}/${item.name}`}
              className="break-words text-xs"
            >
              {item.name} ({item.path}) · {impactChangeLabel(item.change)} · {item.side.label} ·{" "}
              {item.side.email}
            </p>
          ))}
        </div>
      ) : null}
      {!query.isPending && !query.error && !records.length && !changes.length ? (
        <p className="text-xs text-muted-foreground">No live impact overlaps.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
