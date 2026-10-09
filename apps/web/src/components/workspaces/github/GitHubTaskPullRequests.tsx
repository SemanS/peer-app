import { pullRequestRows, taskDelivery } from "@t3tools/client-runtime/peer/github";
import { ensureLocalApi } from "../../../localApi";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import type { TaskContextSlotProps } from "../slots.types";
export function GitHubTaskPullRequests({
  status,
  workspace,
  project,
  scope,
}: TaskContextSlotProps) {
  if (!scope.startsWith("task:")) return null;
  const projectState = status.workspaces
    .find((w) => w.slug === workspace)
    ?.projects.find((p) => p.project.id === project);
  const task = scope.slice(5),
    threads = projectState?.work.threads ?? [];
  const rows = pullRequestRows(
    threads,
    task,
    new Map(projectState?.project.members.map((m) => [m.email, m.name]) ?? []),
  );
  const summary = taskDelivery(threads, task);
  const configured =
    status.github.verification?.find((v) => v.workspace === workspace)?.configured === true;
  if (!rows.length && !summary.hosts.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Pull requests</h3>
      {rows.length ? (
        <Badge
          variant={
            summary.closedUnmerged
              ? "warning"
              : configured && summary.verifiedAll && summary.merged === summary.total
                ? "success"
                : "outline"
          }
        >
          {summary.merged}/{summary.total} merged
          {configured ? (summary.verifiedAll ? " · Verified by GitHub" : " · unverified") : ""}
        </Badge>
      ) : null}
      {rows.map((row) => (
        <div key={row.url} className="space-y-1 text-sm">
          <Button
            size="sm"
            variant="link"
            onClick={() => void ensureLocalApi().shell.openExternal(row.url)}
          >
            PR #{row.number}
          </Button>
          <p>
            {row.headBranch}
            {row.baseBranch ? ` → ${row.baseBranch}` : ""} · {row.state} · {row.source}
          </p>
          {row.verifiedAt ? (
            <p className="text-xs text-muted-foreground">
              Verified {row.verifiedAt}
              {row.mergedAt ? ` · merged ${row.mergedAt}` : ""}
              {row.closedAt ? ` · closed ${row.closedAt}` : ""}
              {row.mergeCommit ? ` · merge ${row.mergeCommit}` : ""}
            </p>
          ) : null}
          {row.disagreement ? (
            <p className="text-sm text-muted-foreground">
              The owner's Peer reports {row.reportedState}. Redeliver the merge event from the
              repository's webhook settings if GitHub missed it.
            </p>
          ) : null}
          {row.state === "closed" ? (
            <p className="text-sm text-muted-foreground">
              An agent cannot finish this task until it merges or a person closes the task.
            </p>
          ) : null}
        </div>
      ))}
      {summary.hosts.map((host) => (
        <p key={host} className="text-sm text-muted-foreground">
          Delivery on {host} is not verified; a person closes the task.
        </p>
      ))}
    </section>
  );
}
