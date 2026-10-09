import { sentPeerRequests } from "@t3tools/client-runtime/peer/requests";
import { useState } from "react";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import type { ProjectSlotProps } from "../slots.types";
import { failureMessage } from "../WorkspaceAccess";
import { requestRow } from "./requests.logic";
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
    <ul aria-label="Sent requests" className="flex flex-col gap-2 text-xs">
      {rows.map(({ workspace, request }) => {
        const view = requestRow(request, status.email, now);
        return (
          <li key={request.id}>
            <p>
              {request.title} · {request.recipient} · {view.outcome}
            </p>
            {view.expiry === undefined ? null : (
              <p className="text-muted-foreground">{view.expiry}</p>
            )}
            {view.withdraw ? (
              <Button
                type="button"
                size="xs"
                variant="ghost-muted"
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
            ) : null}
            {errors.has(request.id) ? (
              <p role="alert" className="text-destructive">
                {errors.get(request.id)}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
