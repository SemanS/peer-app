/**
 * Changes whose agent has gone. The Hub drops a session's report when the session ends, which is
 * right for who works where, but the work stays in the task's jj workspace until it lands. jj keeps
 * that binding itself, in the workspace's name, so nothing to store can go stale and a restart
 * loses nothing. These rows are this computer's alone: the Hub never hears of them.
 *
 * @module peerHub/plugins/changes/client/parked
 */
import type { ChangeRow, ReportedChange } from "@t3tools/contracts";

/** The task a workspace was made for: its name holds the task's id or key as whole words. */
export function taskOfWorkspace<
  Task extends { readonly id: string; readonly key?: string | undefined },
>(name: string, tasks: ReadonlyArray<Task>): Task | undefined {
  const words = `-${name.toLowerCase()}-`;
  return tasks.find((task) =>
    [task.id, task.key].some(
      (word) => word !== undefined && word !== "" && words.includes(`-${word.toLowerCase()}-`),
    ),
  );
}

/** A change no session reports, as the Changes views read a row. */
export function parkedRow(
  change: ReportedChange,
  input: {
    readonly project: string;
    readonly task: string;
    readonly email: string;
    readonly agent: string;
    readonly at: string;
  },
): ChangeRow {
  const { kind, ...fact } = change;
  return {
    ...fact,
    project: input.project,
    parentCommits: change.parentCommits ?? [],
    // Nobody works in it, whatever jj's working copy of that workspace says.
    working: false,
    author: { email: input.email, agent: input.agent },
    versions: [{ commit: change.commitId, at: input.at, kind }],
    sessions: [],
    lastReportAt: input.at,
    task: input.task,
    source: "live",
    sourceAt: input.at,
  };
}
