import { pullRequestRows, taskDelivery } from "@t3tools/client-runtime/peer/github";

import { ensureLocalApi } from "../../../localApi";
import { cn } from "../../../lib/utils";
import { PullRequestGlyph } from "../../pullRequest/pullRequestIcons";
import { Button } from "../../ui/button";
import { TONE_SURFACE, TONE_TEXT, type SignalTone } from "../signals";
import type { TaskContextSlotProps } from "../slots.types";

/** A pull request's state as delivery reads it: open and merged are delivery, closed waits on a person. */
function pullState(state: string): {
  readonly label: string;
  readonly tone: SignalTone;
  readonly Icon: (typeof PullRequestGlyph)[keyof typeof PullRequestGlyph];
} {
  switch (state) {
    case "merged":
      return { label: "Merged", tone: "delivery", Icon: PullRequestGlyph.merged };
    case "closed":
      return { label: "Closed unmerged", tone: "needs", Icon: PullRequestGlyph.closed };
    default:
      return { label: "Open", tone: "delivery", Icon: PullRequestGlyph.pullRequest };
  }
}

/** A task's pull requests, one card each: number, branches, state, and the way to open it. */
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
    <section aria-label="Pull requests" className="flex flex-col gap-2">
      {rows.map((row) => {
        const state = pullState(row.state);
        return (
          <div key={row.url} className="flex flex-col gap-1.5">
            <div
              className={cn(
                "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3.5 py-2.5",
                TONE_SURFACE[state.tone],
              )}
            >
              <state.Icon aria-hidden className={cn("size-4 shrink-0", TONE_TEXT[state.tone])} />
              <span className="text-sm font-semibold text-foreground">#{row.number}</span>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {row.headBranch}
                {row.baseBranch ? ` → ${row.baseBranch}` : ""}
              </span>
              <span className="flex-1" />
              <span className={cn("text-xs font-medium", TONE_TEXT[state.tone])}>
                {state.label}
                {configured ? (row.verified ? " · verified by GitHub" : " · unverified") : ""}
              </span>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void ensureLocalApi().shell.openExternal(row.url)}
              >
                Open on GitHub
              </Button>
            </div>
            {row.verifiedAt ? (
              <p className="text-xs text-muted-foreground">
                Verified {row.verifiedAt}
                {row.mergedAt ? ` · merged ${row.mergedAt}` : ""}
                {row.closedAt ? ` · closed ${row.closedAt}` : ""}
                {row.mergeCommit ? ` · merge ${row.mergeCommit}` : ""}
                {` · ${row.source}`}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Source: {row.source}</p>
            )}
            {row.note === null ? null : <p className="text-xs text-muted-foreground">{row.note}</p>}
            {row.state === "closed" ? (
              <p className="text-xs text-muted-foreground">
                An agent cannot finish this task until it merges or a person closes the task.
              </p>
            ) : null}
          </div>
        );
      })}
      {rows.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          {summary.merged}/{summary.total} merged
        </p>
      ) : null}
      {summary.hosts.map((host) => (
        <p key={host} className="text-xs text-muted-foreground">
          Delivery on {host} is not verified; a person closes the task.
        </p>
      ))}
    </section>
  );
}
