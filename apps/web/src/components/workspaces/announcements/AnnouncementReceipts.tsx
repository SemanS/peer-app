import { useEffect, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { canPollAnnouncement, receiptLabel } from "@t3tools/client-runtime/peer/announcements";
import { useEnvironmentQuery } from "../../../state/query";
import { Badge } from "../../ui/badge";
import { announcementAtoms } from "./atoms";
import { RECEIPT_BADGE } from "./receiptTones";
export function AnnouncementReceipts({
  environmentId,
  workspace,
  project,
  id,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly id: string;
  readonly status: string;
}) {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const query = useEnvironmentQuery(
    visible ? announcementAtoms.detail({ environmentId, input: { workspace, project, id } }) : null,
  );
  const active = query.data?.status ?? status;
  useEffect(() => {
    if (!canPollAnnouncement(visible, active)) return;
    const timer = setInterval(query.refresh, 15000);
    return () => clearInterval(timer);
  }, [visible, active, query.refresh]);
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2.5 text-xs">
      {query.error ? (
        <p role="alert" className="text-destructive-foreground">
          {query.error}
        </p>
      ) : null}
      {query.isPending && !query.data ? (
        <p role="status" className="text-muted-foreground">
          Loading receipts…
        </p>
      ) : null}
      {query.data?.audience.length === 0 ? (
        <p className="text-muted-foreground">No live agents or receipts yet.</p>
      ) : null}
      {query.data?.audience.map((row) => (
        <p
          key={`${row.email}/${row.environment}/${row.session}`}
          className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5"
        >
          <span className="truncate font-medium text-foreground">{row.email}</span>
          <span className="truncate text-muted-foreground">
            {row.agent ?? row.session} · {row.environment}
            {row.live ? "" : " · session ended"}
          </span>
          <span className="flex-1" />
          <Badge variant={RECEIPT_BADGE[row.state]} size="sm">
            {receiptLabel(row.state)}
          </Badge>
        </p>
      ))}
    </div>
  );
}
