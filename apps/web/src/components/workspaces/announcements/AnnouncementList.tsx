import { MegaphoneIcon } from "lucide-react";
import { useState } from "react";
import type { EnvironmentId, PeerAnnouncementCounts, PeerHubStatus } from "@t3tools/contracts";
import {
  announcementAuthor,
  announcementTiming,
  recentAnnouncements,
  receiptLabel,
  mayWithdrawAnnouncement,
} from "@t3tools/client-runtime/peer/announcements";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useLiveRefresh } from "../../../hooks/useLiveRefresh";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { cn } from "../../../lib/utils";
import { PeerSectionLabel } from "../PeerPageHeader";
import { TONE_SURFACE } from "../signals";
import { failureMessage } from "../WorkspaceAccess";
import type { ProjectSlotProps } from "../slots.types";
import { announcementAtoms } from "./atoms";
import { AnnouncementReceipts } from "./AnnouncementReceipts";
import { RECEIPT_BADGE } from "./receiptTones";
export function ProjectAnnouncements({ environmentId, status, project }: ProjectSlotProps) {
  const summary = status.announcements?.projects.find(
    (s) => s.workspace === project.workspace && s.project === project.projectId,
  );
  // What holds now, one line each; a click shows the whole text, receipts and Withdraw.
  return !summary?.active ? null : (
    <AnnouncementList
      environmentId={environmentId}
      status={status}
      workspace={project.workspace}
      project={project.projectId}
      compact
    />
  );
}
export function AnnouncementList({
  environmentId,
  status,
  workspace,
  project,
  recent = false,
  refreshKey,
  compact = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: string;
  readonly recent?: boolean;
  readonly refreshKey?: string | undefined;
  /** Each announcement as one line until it is opened. */
  readonly compact?: boolean;
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
  const [opened, setOpened] = useState<string | null>(null);
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
  const taskTitle = (id: string) => {
    const task = member?.projects
      .find((p) => p.project.id === project)
      ?.work.tasks.find((t) => t.id === id);
    return task === undefined
      ? id
      : task.key === undefined
        ? task.title
        : `${task.key} · ${task.title}`;
  };
  return (
    <section
      aria-label={recent ? "Recent announcements" : "Announcements"}
      className={cn("flex flex-col", compact ? "gap-1" : "gap-2.5")}
    >
      {recent ? <PeerSectionLabel>Recent announcements</PeerSectionLabel> : null}
      {query.error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-muted-foreground">
          {query.error}
          <Button size="xs" variant="outline" onClick={query.refresh}>
            Retry
          </Button>
        </p>
      ) : null}
      {query.isPending && !query.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading announcements…
        </p>
      ) : null}
      {rows.map((row) =>
        compact && opened !== row.id ? (
          <button
            key={row.id}
            type="button"
            aria-expanded={false}
            className={cn(
              "flex w-full min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 text-left outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring",
              TONE_SURFACE.team,
            )}
            onClick={() => setOpened(row.id)}
          >
            <MegaphoneIcon
              aria-hidden
              className="mt-0.5 size-3.5 shrink-0 text-peer-team-foreground"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="line-clamp-2 text-xs text-sidebar-foreground">{row.text}</span>
              <span className="truncate text-2xs text-peer-team-foreground">
                Announcement · {announcementTiming(row, query.data!.at)}
              </span>
            </span>
          </button>
        ) : (
          <article
            key={row.id}
            className={cn(
              "flex flex-col gap-2 rounded-xl border",
              compact ? cn("p-2.5", TONE_SURFACE.team) : "border-border bg-card p-3.5",
            )}
          >
            <p className="text-sm whitespace-pre-wrap text-foreground">{row.text}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
              <span>{announcementAuthor(row.author)}</span>
              <span aria-hidden>·</span>
              <span>{row.task ? taskTitle(row.task) : "Whole project"}</span>
              <span aria-hidden>·</span>
              <span>{announcementTiming(row, query.data!.at)}</span>
              <Badge variant={STATE_BADGE[row.status ?? "active"] ?? "secondary"} size="sm">
                {STATE_LABEL[row.status ?? "active"] ?? row.status}
              </Badge>
            </p>
            <ReceiptChips counts={row.counts} />
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="xs"
                variant="outline"
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
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void takeBack(row.id)}
                >
                  Withdraw
                </Button>
              ) : null}
              {compact ? (
                <Button size="xs" variant="ghost" aria-expanded onClick={() => setOpened(null)}>
                  Show less
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
          </article>
        ),
      )}
      {recent && rows.length === 0 && !query.isPending ? (
        <p className="text-sm text-muted-foreground">No recent announcements.</p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </section>
  );
}

const STATE_LABEL: Readonly<Record<string, string>> = {
  active: "Active",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

const STATE_BADGE: Readonly<Record<string, "team" | "secondary">> = {
  active: "team",
  withdrawn: "secondary",
  expired: "secondary",
};

/** How far each receipt got, furthest first. */
const RECEIPT_ORDER = [
  "acknowledged",
  "model-input",
  "offered",
  "waiting",
  "not-following",
] as const;

/** The receipts as counts per state, in their tones, without the states nobody is in. */
function ReceiptChips({ counts }: { readonly counts: PeerAnnouncementCounts }) {
  const states = RECEIPT_ORDER.filter((state) => counts[state] > 0);
  if (states.length === 0) {
    return <p className="text-xs text-muted-foreground">No agent has heard it yet.</p>;
  }
  return (
    <div aria-label="Receipts" className="flex flex-wrap gap-1">
      {states.map((state) => (
        <Badge key={state} variant={RECEIPT_BADGE[state]} size="sm">
          {`${counts[state]} ${receiptLabel(state).toLowerCase()}`}
        </Badge>
      ))}
    </div>
  );
}
