import { useAtomValue } from "@effect/atom-react";
import { NO_RUNS_TEXT } from "@t3tools/client-runtime/peer/runs";
import type { EnvironmentId, PeerRun } from "@t3tools/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { PeerSectionLabel } from "../PeerPageHeader";
import { TONE_TEXT } from "../signals";
import { confirmed } from "../workFeedback";
import { failureMessage } from "../WorkspaceAccess";
import type { WorkOpen } from "../workTree.logic";
import type { TaskRunRow } from "./runs.logic";
import type { TaskChatRow } from "./taskChats.logic";
import { PersonMark, TaskChatItem } from "./TaskSections";

const NO_RUNS: ReadonlyArray<PeerRun> = [];

/**
 * A task's runs from the Hub, read when the page opens and again whenever `revision` (what the
 * live work view says about the task) changes, so a run another computer started or ended shows
 * without a timer polling the Hub.
 */
export function useTaskRuns(input: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly revision: string;
}) {
  const { environmentId, workspace, projectId, taskId, revision } = input;
  const query = useEnvironmentQuery(
    serverEnvironment.peerRunsList({ environmentId, input: { workspace, projectId, taskId } }),
  );
  const { refresh } = query;
  // The query reads on mount; only a later change of the work view reads again.
  const seen = useRef(revision);
  useEffect(() => {
    if (revision === seen.current) return;
    seen.current = revision;
    refresh();
  }, [refresh, revision]);
  return {
    runs: query.data?.runs ?? NO_RUNS,
    loading: query.data === null && query.error === null,
    error: query.error,
    refresh,
  };
}

/**
 * The task's Runs section: one row per run, newest first, with Open where its agent has a view on
 * this computer, Continue for the person's detached run and End run for what they may end. Chats
 * no run covers yet follow as they always showed, so nothing leaves the page.
 */
export function TaskRuns({
  environmentId,
  workspace,
  projectId,
  rows,
  chats,
  loading,
  error,
  onChanged,
  onOpen,
  onAsk,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly projectId: string;
  readonly rows: ReadonlyArray<TaskRunRow>;
  readonly chats: ReadonlyArray<TaskChatRow>;
  readonly loading: boolean;
  readonly error: string | null;
  /** Reads the runs again after this page changed one. */
  readonly onChanged: () => void;
  readonly onOpen: (open: WorkOpen) => void;
  readonly onAsk: ((row: TaskChatRow) => void) | undefined;
  readonly children?: ReactNode;
}) {
  const endRun = useAtomCommand(serverEnvironment.peerRunsEnd, { reportFailure: false });
  const continueRun = useAtomCommand(serverEnvironment.peerRunsContinue, { reportFailure: false });
  const canEndHere = useAtomValue(serverEnvironment.peerRunsEnd.permissionAtom(environmentId));
  const canContinueHere = useAtomValue(
    serverEnvironment.peerRunsContinue.permissionAtom(environmentId),
  );
  const [busy, setBusy] = useState<string | null>(null);
  // One line per run, beside the button that caused it: a refused Continue says why there.
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map());
  const note = (id: string, text: string | undefined) =>
    setNotes((current) => {
      const next = new Map(current);
      if (text === undefined) next.delete(id);
      else next.set(id, text);
      return next;
    });
  const scope = { workspace, projectId };

  const doContinue = async (row: TaskRunRow) => {
    setBusy(row.id);
    note(row.id, undefined);
    const result = await continueRun({ environmentId, input: { ...scope, runId: row.id } });
    setBusy(null);
    if (result._tag === "Success") {
      note(
        row.id,
        result.value.started ? undefined : (result.value.reason ?? "It could not continue."),
      );
      onChanged();
      return;
    }
    note(row.id, failureMessage(result) ?? undefined);
  };
  const doEnd = async (row: TaskRunRow) => {
    if (!(await confirmed(`End the run of ${row.agent}? Its agent's sessions stay as they are.`)))
      return;
    setBusy(row.id);
    note(row.id, undefined);
    const result = await endRun({ environmentId, input: { ...scope, runId: row.id } });
    setBusy(null);
    note(row.id, failureMessage(result) ?? undefined);
    onChanged();
  };

  const count = rows.length + chats.length;
  return (
    <section aria-label="Runs" className="flex flex-col gap-2.5">
      <PeerSectionLabel
        after={<span className="font-normal text-muted-foreground tabular-nums">{count}</span>}
      >
        Runs
      </PeerSectionLabel>
      {error === null ? null : (
        <p role="alert" className="text-sm text-muted-foreground">
          {error}
        </p>
      )}
      {count === 0 ? (
        <p role={loading ? "status" : undefined} className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `${NO_RUNS_TEXT}. Start an agent to put one on it.`}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60 border-y border-border/60">
          {rows.map((row) => {
            const open = row.open;
            const rowNote = notes.get(row.id);
            return (
              <li key={row.id} className="flex min-h-16 flex-wrap items-center gap-3 py-4">
                <PersonMark name={row.person} mine={row.mine} />
                <span className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {row.agent} · {row.runtime}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {[row.person, row.sessions, row.when].join(" · ")}
                  </span>
                  {row.hint === undefined ? null : (
                    <span className="text-xs text-muted-foreground">{row.hint}</span>
                  )}
                  {row.handover === undefined ? null : (
                    <span className="text-xs text-muted-foreground">{row.handover}</span>
                  )}
                  {rowNote === undefined ? null : (
                    <span role="status" className="text-xs text-warning-foreground">
                      {rowNote}
                    </span>
                  )}
                </span>
                <span
                  className={cn("inline-flex items-center gap-1.5 text-sm", TONE_TEXT[row.tone])}
                >
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
                  {row.state}
                </span>
                {open === undefined ? null : (
                  <Button variant="ghost" size="sm" onClick={() => onOpen(open)}>
                    Open
                  </Button>
                )}
                {row.canContinue && canContinueHere ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === row.id}
                    onClick={() => void doContinue(row)}
                  >
                    Continue
                  </Button>
                ) : null}
                {row.canEnd && canEndHere ? (
                  <Button
                    variant="ghost-destructive"
                    size="sm"
                    disabled={busy === row.id}
                    onClick={() => void doEnd(row)}
                  >
                    End run
                  </Button>
                ) : null}
              </li>
            );
          })}
          {chats.map((row) => (
            <TaskChatItem key={row.key} row={row} onOpen={onOpen} onAsk={onAsk} />
          ))}
        </ul>
      )}
      {children === undefined ? null : <div className="flex flex-wrap gap-2">{children}</div>}
    </section>
  );
}
