import { sentPeerRequests } from "@t3tools/client-runtime/peer/requests";
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import { useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { PeerSectionLabel } from "../PeerPageHeader";
import type { ProjectSlotProps } from "../slots.types";
import { failureMessage } from "../WorkspaceAccess";
import { requestRow, sentOutcome } from "./requests.logic";

/** The requests the person sent on a project, newest first: who has them and what they answered. */
export function SentRequests({
  environmentId,
  status,
  project,
}: Pick<ProjectSlotProps, "environmentId" | "status" | "project">) {
  const withdraw = useAtomCommand(serverEnvironment.peerHubWithdrawRequest, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState<string | null>(null),
    [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  // Labels use the local clock when this status renders; no timer repaints the list.
  // oxlint-disable-next-line react/purity -- Expiry is a render-time snapshot; requests status replaces expired rows without a timer.
  const now = Date.now();
  const rows = sentPeerRequests(status, {
    workspace: project.workspace,
    project: project.projectId,
  }).slice(0, 8);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Sent requests" className="flex flex-col gap-2.5">
      <PeerSectionLabel>Sent requests</PeerSectionLabel>
      <ul className="flex flex-col gap-2">
        {rows.map(({ workspace, request }) => {
          const view = requestRow(request, status.email, now);
          const outcome = sentOutcome(request);
          return (
            <li
              key={request.id}
              className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3"
            >
              <div className="flex min-w-0 items-start gap-2">
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  {request.title}
                </span>
                <Badge variant={outcome.badge} size="sm">
                  {outcome.label}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                To {personName(status, workspace, request.recipient)} ·{" "}
                {formatRelativeTimeLabel(request.createdAt)}
                {view.expiry === undefined ? "" : ` · ${view.expiry}`}
              </p>
              {request.reason === undefined ? null : (
                <p className="text-sm text-foreground">
                  <span className="text-muted-foreground">Their reason: </span>
                  {request.reason}
                </p>
              )}
              {view.withdraw ? (
                <div>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => {
                      setBusy(request.id);
                      setErrors((previous) => {
                        const next = new Map(previous);
                        next.delete(request.id);
                        return next;
                      });
                      void withdraw({
                        environmentId,
                        input: { workspace, projectId: request.project, requestId: request.id },
                      })
                        .then((result) => {
                          const error = failureMessage(result);
                          if (error !== null)
                            setErrors((previous) => new Map(previous).set(request.id, error));
                        })
                        .finally(() => setBusy(null));
                    }}
                  >
                    {busy === request.id ? "Withdrawing…" : "Withdraw"}
                  </Button>
                </div>
              ) : null}
              {errors.has(request.id) ? (
                <p role="alert" className="text-xs text-destructive-foreground">
                  {errors.get(request.id)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
