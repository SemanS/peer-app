import { useEffect, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { canPollAnnouncement, receiptLabel } from "@t3tools/client-runtime/peer/announcements";
import { useEnvironmentQuery } from "../../../state/query";
import { announcementAtoms } from "./atoms";
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
    <div className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs">
      {query.error ? <p role="alert">{query.error}</p> : null}
      {query.isPending && !query.data ? <p role="status">Loading receipts…</p> : null}
      {query.data?.audience.length === 0 ? <p>No live agents or receipts yet.</p> : null}
      {query.data?.audience.map((row) => (
        <p key={`${row.email}/${row.environment}/${row.session}`}>
          {row.email} · {row.agent ?? row.session} · {row.environment} · {receiptLabel(row.state)}
          {row.live ? "" : " · session ended"}
        </p>
      ))}
    </div>
  );
}
