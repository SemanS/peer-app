import type { PeerConversationReport } from "@t3tools/contracts";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const REPORT_STATE = {
  updating: "Updating in background…",
  current: "Updates automatically",
  partial: "Some sources unavailable",
  unavailable: "Sources unavailable",
  error: "Update failed",
} as const;

export function ConversationReport({
  report,
  isPending,
  isFirstPage,
  onRefresh,
  onPage,
  onOpenThread,
}: {
  readonly report: PeerConversationReport;
  readonly isPending: boolean;
  readonly isFirstPage: boolean;
  readonly onRefresh: () => void;
  readonly onPage: (cursor?: string) => void;
  readonly onOpenThread: (threadId: string) => void;
}) {
  const incomplete = ["partial", "unavailable", "error"].includes(report.state);
  return (
    <section
      aria-label="Conversation report"
      aria-busy={report.state === "updating"}
      className="flex min-w-0 flex-col gap-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="text-lg font-semibold text-foreground">Conversation report</h2>
          <span role="status">
            <Badge variant={incomplete ? "warning" : "secondary"}>
              {REPORT_STATE[report.state]}
            </Badge>
          </span>
        </div>
        <Button size="sm" variant="outline" disabled={isPending} onClick={onRefresh}>
          {isPending ? "Refreshing…" : "Refresh report"}
        </Button>
      </header>

      <div className="flex flex-col gap-1 text-sm">
        <p className="text-foreground">
          {report.total} {report.total === 1 ? "conversation" : "conversations"}
          {` · ${report.working} working · ${report.waiting} waiting`}
        </p>
        <p className="text-muted-foreground">
          Latest requests and replies from this environment, including archived conversations.
          Updates run in the background; replies are the agents’ own reports.
        </p>
        {report.available === report.total ? null : (
          <p className="text-warning-foreground">
            Saved message history was read for {report.available} of {report.total} conversations.
            Incomplete sources are listed below and are not treated as completed work.
          </p>
        )}
      </div>

      {report.error === null ? null : (
        <p role="status" className="text-sm text-warning-foreground">
          {report.error}
        </p>
      )}

      {report.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {report.state === "updating"
            ? "Gathering conversations… The saved context remains available below."
            : report.total === 0 && report.state === "current"
              ? "No conversations are available in this scope yet."
              : "Conversation content is not available yet."}
        </p>
      ) : (
        <ol className="flex min-w-0 flex-col divide-y divide-border">
          {report.items.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-col gap-2 py-4 first:pt-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <h3 className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">
                    {item.title}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {item.status === "done" ? "Turn finished" : item.status.replaceAll("_", " ")}
                    {item.archived ? " · Archived" : ""}
                    {item.updatedAt === null
                      ? ""
                      : ` · Activity ${formatRelativeTimeLabel(item.updatedAt)}`}
                  </p>
                </div>
                {item.threadId === null ? null : (
                  <Button size="xs" variant="outline" onClick={() => onOpenThread(item.threadId!)}>
                    Open conversation
                  </Button>
                )}
              </div>
              {item.response === null ? null : (
                <p className="text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
                  {item.response.length > 320 ? `${item.response.slice(0, 320)}…` : item.response}
                </p>
              )}
              {item.request === null && item.response === null ? null : (
                <details className="text-sm">
                  <summary className="cursor-pointer py-1 text-muted-foreground">
                    Latest request and reply
                  </summary>
                  <div className="flex flex-col gap-2 pt-2">
                    {item.request === null ? null : (
                      <p className="whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
                        <span className="font-medium">Request: </span>
                        {item.request}
                      </p>
                    )}
                    {item.response === null ? null : (
                      <p className="whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
                        <span className="font-medium">Agent reply: </span>
                        {item.response}
                      </p>
                    )}
                  </div>
                </details>
              )}
              {item.availability === "unavailable" ? (
                <p className="text-xs text-warning-foreground">
                  This conversation’s content is unavailable in this environment.
                </p>
              ) : item.request === null && item.response === null ? (
                <p className="text-xs text-muted-foreground">No request or reply recorded yet.</p>
              ) : null}
              {item.availability === "partial" || item.truncated ? (
                <p className="text-xs text-muted-foreground">
                  {item.availability === "partial"
                    ? "Only part of this conversation is available. "
                    : ""}
                  {item.truncated ? "Excerpts are shortened. " : ""}
                  {item.threadId === null ? "" : "Open the conversation for full detail."}
                </p>
              ) : null}
              {item.responseAt === null ? null : (
                <p className="text-xs text-muted-foreground">
                  Reply {formatRelativeTimeLabel(item.responseAt)}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {isFirstPage && report.coverage.nextCursor === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {isFirstPage ? null : (
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => onPage()}>
              First conversations
            </Button>
          )}
          {report.coverage.nextCursor === null ? null : (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => onPage(report.coverage.nextCursor!)}
            >
              More conversations
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            Showing {report.items.length} of {report.total}
          </span>
        </div>
      )}

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>
          {report.updatedAt === null
            ? "First report pending"
            : `Report updated ${formatRelativeTimeLabel(report.updatedAt)}`}
        </span>
        {report.checkedAt === null ? null : (
          <span>Sources checked {formatRelativeTimeLabel(report.checkedAt)}</span>
        )}
      </footer>
    </section>
  );
}
