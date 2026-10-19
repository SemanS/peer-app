import {
  markReviewedLabel,
  reviewState,
  reviewVersions,
  taskStack,
} from "@t3tools/client-runtime/peer/changes";
import { agentName, personName } from "@t3tools/client-runtime/peer/jujutsu";
import type { ReviewDiffMode } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { useState } from "react";

import { useClientSettings } from "../../../hooks/useSettings";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatShortTimestamp } from "../../../timestampFormat";
import { withFinally } from "~/lib/withFinally";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { PeerSectionLabel } from "../PeerPageHeader";
import type { TaskContextSlotProps } from "../slots.types";
import { failureMessage } from "../WorkspaceAccess";
import { ChangeId } from "./ChangeGraph";
import { changeIdParts } from "@t3tools/client-runtime/peer/changes";
import {
  compareLabels,
  defaultMode,
  diffNotes,
  keyedLines,
  reviewStanding,
} from "./changeReview.logic";
import { useProjectChanges } from "./useProjectChanges";

/**
 * The review of a task's change by its versions, as its author's computer reported them: what
 * moved since the person last marked one reviewed, or the whole change, each with the jj command
 * that ran. A mark stays on the person's own computer and never touches a pull request.
 */
export function ChangeReview({
  environmentId,
  status,
  workspace,
  project,
  scope,
}: TaskContextSlotProps) {
  const taskId = scope.startsWith("task:") ? scope.slice("task:".length) : undefined;
  const hubTask = status.workspaces
    .find((entry) => entry.slug === workspace)
    ?.projects.find((entry) => entry.project.id === project)
    ?.work.tasks.find((task) => task.id === taskId);
  const now = useRelativeTimeTick(30_000);
  const live = useProjectChanges({ environmentId, workspace, project });
  if (taskId === undefined || live.view === undefined) return null;
  const stack = taskStack(live.view, hubTask?.key ?? taskId, { me: status.email ?? null, now });
  const row = stack.entries[0]?.change;
  if (row === undefined) return null;
  return (
    <ReviewBody
      environmentId={environmentId}
      workspace={workspace}
      project={project}
      row={row}
      marks={live.view.marks}
      all={live.view.changes.map((change) => change.changeId)}
      me={status.email ?? null}
    />
  );
}

function ReviewBody({
  environmentId,
  workspace,
  project,
  row,
  marks,
  all,
}: Pick<TaskContextSlotProps, "environmentId" | "workspace" | "project"> & {
  readonly row: NonNullable<ReturnType<typeof taskStack>["entries"][number]>["change"];
  readonly marks: ReadonlyArray<import("@t3tools/contracts").ReviewMark>;
  readonly all: ReadonlyArray<string>;
  readonly me: string | null;
}) {
  const navigate = useNavigate();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const clock = (at: string) => formatShortTimestamp(at, timestampFormat);
  const mark = marks.find((candidate) => candidate.changeId === row.changeId);
  const state = reviewState(row, marks);
  const versions = reviewVersions(row, mark);
  const next = markReviewedLabel(row, mark);
  const [picked, setPicked] = useState<ReviewDiffMode | undefined>(undefined);
  const mode = picked ?? defaultMode(state);
  const labels = compareLabels(row, mark);
  const diff = useEnvironmentQuery(
    serverEnvironment.peerChangesReviewDiff({
      environmentId,
      input: { workspace, project, changeId: row.changeId, mode },
    }),
  );
  const markReviewed = useAtomCommand(serverEnvironment.peerChangesMarkReviewed, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (input: { commit: string; version: number; unmark?: boolean }) => {
    setBusy(true);
    setError(null);
    await withFinally(
      async () => {
        const result = await markReviewed({
          environmentId,
          input: { workspace, project, changeId: row.changeId, ...input },
        });
        setError(failureMessage(result));
      },
      () => setBusy(false),
    );
  };
  const person = personName(row.author.email);
  const first = row.versions.at(0);
  const notes = diff.data === null ? [] : diffNotes(diff.data, row);

  return (
    <section aria-labelledby="change-review" className="flex flex-col gap-4">
      <h2 id="change-review" className="contents">
        <PeerSectionLabel>Versions of the change</PeerSectionLabel>
      </h2>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        {person} · {agentName(row.author.agent)} · change{" "}
        <ChangeId {...changeIdParts(row.changeId, all)} />
        {first === undefined ? null : ` · ${row.versions.length} versions since ${clock(first.at)}`}
      </p>

      <div className="flex flex-col gap-2">
        <PeerSectionLabel>Versions, as {person}'s computer reported them</PeerSectionLabel>
        <ol className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {versions.map((version) => (
            <li key={version.n} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2">
              <span className="flex items-center gap-1 font-mono text-xs text-foreground tabular-nums">
                v{version.n} · {clock(version.at)}
                {version.marked ? <CheckIcon aria-hidden className="size-3.5" /> : null}
              </span>
              <span className="text-sm text-muted-foreground">{version.label}</span>
              {version.marked ? (
                <Badge variant="success" size="sm">
                  You marked it reviewed
                </Badge>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            aria-label="Compare"
            value={[mode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "since" || next === "whole") setPicked(next);
            }}
          >
            <Toggle value="since" disabled={mark === undefined}>
              {labels.since}
            </Toggle>
            <Toggle value="whole">{labels.whole}</Toggle>
          </ToggleGroup>
          {diff.data?.command === undefined ? null : (
            <code className="font-mono text-xs break-all text-muted-foreground">
              {diff.data.command}
            </code>
          )}
        </div>
        {diff.data === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            {diff.error ?? "Reading the diff on this computer…"}
          </p>
        ) : (
          <div aria-label="Diff" className="flex flex-col gap-2">
            {diff.data.files.length === 0 && diff.data.state !== "notHere" ? (
              <p className="text-sm text-muted-foreground">Nothing moved in this view.</p>
            ) : null}
            {diff.data.files.map((file) => (
              <div key={file.path} className="overflow-hidden rounded-lg border border-border">
                <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 font-mono text-xs">
                  <span className="min-w-0 flex-1 truncate text-foreground">{file.path}</span>
                  {file.added > 0 ? (
                    <span className="text-success-foreground">+{file.added}</span>
                  ) : null}
                  {file.removed > 0 ? (
                    <span className="text-destructive-foreground">−{file.removed}</span>
                  ) : null}
                </div>
                <pre className="overflow-x-auto py-1 font-mono text-xs">
                  {keyedLines(file.lines).map((line) => (
                    <div
                      key={line.key}
                      className={
                        "flex gap-3 px-3 whitespace-pre " +
                        (line.kind === "add"
                          ? "bg-success/8"
                          : line.kind === "del"
                            ? "bg-destructive/8"
                            : "")
                      }
                    >
                      {/* A tinted line's number takes the line's tone: muted grey falls under
                          4.5:1 on the tint. */}
                      <span
                        aria-hidden
                        className={
                          "w-6 shrink-0 text-right " +
                          (line.kind === "add"
                            ? "text-success-foreground"
                            : line.kind === "del"
                              ? "text-destructive-foreground"
                              : "text-muted-foreground")
                        }
                      >
                        {line.n}
                      </span>
                      <span className="text-foreground">
                        {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                        {line.text}
                      </span>
                    </div>
                  ))}
                </pre>
              </div>
            ))}
            {notes.map((note) => (
              <p key={note} className="text-xs text-muted-foreground">
                {note}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3">
        <PeerSectionLabel>Your review</PeerSectionLabel>
        <p className="text-sm text-foreground">{reviewStanding(row, state, versions, clock)}</p>
        <div className="flex flex-wrap items-center gap-2">
          {next === null ? null : (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void run({ commit: next.commit, version: next.version })}
            >
              {next.label}
            </Button>
          )}
          {mark === undefined ? null : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run({ commit: mark.commit, version: mark.version, unmark: true })}
            >
              Take back my mark
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void navigate({ to: "/changes/$workspace/$project", params: { workspace, project } })
            }
          >
            Back to Changes
          </Button>
        </div>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          A mark belongs to a version and stays on your computer. If {person} changes it again, even
          after a force-push, Peer shows you only what moved after it: the change id stays the same.
          Reviews on GitHub are not touched.
        </p>
      </div>
    </section>
  );
}
