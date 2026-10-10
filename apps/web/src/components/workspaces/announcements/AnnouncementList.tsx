import { useState } from "react";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import {
  announcementAuthor,
  announcementTiming,
  recentAnnouncements,
  receiptCounts,
  mayWithdrawAnnouncement,
} from "@t3tools/client-runtime/peer/announcements";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useLiveRefresh } from "../../../hooks/useLiveRefresh";
import { Button } from "../../ui/button";
import { failureMessage } from "../WorkspaceAccess";
import type { ProjectSlotProps } from "../slots.types";
import { announcementAtoms } from "./atoms";
import { AnnouncementReceipts } from "./AnnouncementReceipts";
export function ProjectAnnouncements({ environmentId, status, project }: ProjectSlotProps) {
  const summary = status.announcements?.projects.find(
    (s) => s.workspace === project.workspace && s.project === project.projectId,
  );
  return !summary?.active ? null : (
    <div className="p-2">
      <p className="text-sm font-medium">Announcements · {summary.active} active</p>
      <AnnouncementList
        environmentId={environmentId}
        status={status}
        workspace={project.workspace}
        project={project.projectId}
      />
    </div>
  );
}
export function AnnouncementList({
  environmentId,
  status,
  workspace,
  project,
  recent = false,
  refreshKey,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: string;
  readonly recent?: boolean;
  readonly refreshKey?: string | undefined;
}) {
  const rev = status.announcements?.projects.find(
    (s) => s.workspace === workspace && s.project === project,
  )?.rev;
  const query = useEnvironmentQuery(
    announcementAtoms.list({
      environmentId,
      input: { workspace, project, rev: `${rev ?? ""}/${refreshKey ?? ""}` },
    }),
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const withdraw = useAtomCommand(announcementAtoms.withdraw, { reportFailure: false });
  const member = status.workspaces.find((w) => w.slug === workspace);
  const role = member?.projects.find((p) => p.project.id === project)?.project.role ?? "member";
  const announcements = query.data?.announcements ?? [];
  const active = announcements.filter(
    (a) =>
      a.status === "active" ||
      (a.status === undefined &&
        !a.withdrawnAt &&
        Date.parse(a.expiresAt) > Date.parse(query.data!.at)),
  );
  const rows = recent ? recentAnnouncements(announcements) : active;
  // Receipt changes do not change the active-ID revision or publish Hub change pings. The project
  // row and the Notify agents dialog show the project at once, each with its own query, so each
  // is its own view: a shared key let whichever read first starve the other.
  useLiveRefresh(query.isPending ? null : query.refresh, {
    enabled: active.length > 0,
    key: JSON.stringify(["announcements", environmentId, workspace, project, recent, refreshKey]),
    intervalMs: 15_000,
  });
  async function takeBack(id: string) {
    setBusy(true);
    try {
      const result = await withdraw({ environmentId, input: { workspace, project, id } });
      setMessage(failureMessage(result) ?? "Announcement withdrawn.");
      query.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      {recent ? <h3 className="text-sm font-medium">Recent announcements</h3> : null}
      {query.error ? (
        <p role="alert">
          {query.error}
          <Button size="sm" variant="ghost" onClick={query.refresh}>
            Retry
          </Button>
        </p>
      ) : null}
      {query.isPending && !query.data ? <p role="status">Loading announcements…</p> : null}
      {rows.map((row) => (
        <div key={row.id} className="rounded-md border p-3">
          <p className="whitespace-pre-wrap text-sm">{row.text}</p>
          <p className="text-xs text-muted-foreground">
            {announcementAuthor(row.author)} ·{" "}
            {row.task
              ? `Task: ${member?.projects.find((p) => p.project.id === project)?.work.tasks.find((t) => t.id === row.task)?.title ?? row.task}`
              : "Whole project"}{" "}
            · {row.status ?? "active"} · {announcementTiming(row, query.data!.at)}
          </p>
          <p className="text-xs text-muted-foreground">{receiptCounts(row.counts)}</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={expanded === row.id}
              onClick={() => setExpanded(expanded === row.id ? null : row.id)}
            >
              {expanded === row.id ? "Hide receipts" : "Receipts"}
            </Button>
            {row.status !== "withdrawn" &&
            row.status !== "expired" &&
            mayWithdrawAnnouncement(
              row.author,
              status.email ?? "",
              role,
              member?.role ?? "member",
            ) ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void takeBack(row.id)}
              >
                Withdraw
              </Button>
            ) : null}
          </div>
          {expanded === row.id ? (
            <AnnouncementReceipts
              environmentId={environmentId}
              workspace={workspace}
              project={project}
              id={row.id}
              status={row.status ?? "active"}
            />
          ) : null}
        </div>
      ))}
      {recent && rows.length === 0 && !query.isPending ? (
        <p className="text-sm text-muted-foreground">No recent announcements.</p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
