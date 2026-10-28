import { Badge } from "../../ui/badge";
import { PeerSectionLabel } from "../PeerPageHeader";
import type { TaskSlotProps } from "../slots.types";
import { CHANGED_FILES_LINE, taskRoleRows } from "./roles.logic";

/**
 * A task's review sessions on its page: who runs each, what the session is, and its role
 * ("reviewing", or "reviewing · advisory" where Peer cannot stop its edits), with a warning line
 * when the Hub says its files changed through the shell. Read-only: a role changes from its
 * thread's menu.
 */
export function ReviewSessions({ status, workspace, project, task }: TaskSlotProps) {
  if (project === undefined) return null;
  const rows = taskRoleRows(
    status,
    { workspace, project: project.project.id, task: task.id },
    project.project.members,
  );
  if (rows.length === 0) return null;
  return (
    <section aria-label="Review sessions" className="flex flex-col gap-3">
      <PeerSectionLabel>Review sessions</PeerSectionLabel>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="min-w-0 truncate text-sm font-medium text-foreground">
                {row.who} · {row.session}
              </span>
              <Badge
                variant={row.advisory || row.changedFiles ? "warning" : "team"}
                size="sm"
                aria-label={`Role: ${row.label}`}
              >
                {row.label}
              </Badge>
            </div>
            <p className="max-w-prose text-xs text-muted-foreground">{row.detail}</p>
            {row.changedFiles ? (
              <p role="status" className="max-w-prose text-xs text-warning-foreground">
                {CHANGED_FILES_LINE}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
