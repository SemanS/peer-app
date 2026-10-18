import type { PeerWorkThread } from "@t3tools/contracts";
import type { ReportedThread } from "../../core/plugin.ts";
import { fetchedRef, isForecastRef } from "./git.ts";
import { MAX_BRANCHES, MAX_PAIRS } from "./limits.ts";
export type Subject = {
  workspace: string;
  project: string;
  repository: string;
  branch: string;
  email: string;
  title: string;
  task?: string;
  where: "here" | "origin";
  ref: string;
  live: boolean;
  at: number;
  /** The agent working on it, from its thread. */
  agent?: string;
  /** A Jujutsu checkout reads each side from somewhere: its working copy, shared work or a pushed bookmark. */
  source?: "live" | "shared" | "pushed";
  readAt?: number;
  /** When its change was started (author time) and its jj change id, once read. */
  started?: number;
  changeId?: string;
};
export function selectSubjects(input: {
  workspace: string;
  project: string;
  repository: string;
  base: string;
  email: string;
  environment: string;
  teammates: boolean;
  local: ReadonlyArray<ReportedThread>;
  remote: ReadonlyArray<PeerWorkThread>;
  tasks: ReadonlyArray<{ id: string; title: string; key?: string | undefined; status: string }>;
}) {
  const subjects: Subject[] = [];
  const add = (thread: ReportedThread | PeerWorkThread, where: Subject["where"]) => {
    const branch = thread.branch;
    if (
      branch === undefined ||
      !isForecastRef(branch) ||
      [input.base, "main", "master", "trunk", "develop"].includes(branch) ||
      thread.repository !== input.repository
    )
      return;
    const task = input.tasks.find((candidate) => candidate.id === thread.task);
    const ledger =
      "email" in thread
        ? thread
        : input.remote.find(
            (row) =>
              row.id === thread.id &&
              row.email === input.email &&
              row.environment === input.environment,
          );
    if (task?.status === "done" || ledger?.delivery === "merged" || ledger?.delivery === "closed")
      return;
    subjects.push({
      workspace: input.workspace,
      project: input.project,
      repository: input.repository,
      branch,
      email: where === "here" ? input.email : ledger!.email,
      title: task === undefined ? thread.title : [task.key, task.title].filter(Boolean).join(" · "),
      ...(thread.task === undefined ? {} : { task: thread.task }),
      ...(thread.harness === undefined ? {} : { agent: thread.harness }),
      where,
      ref: where === "here" ? `refs/heads/${branch}` : fetchedRef(branch),
      live: thread.status !== "unknown" && thread.status !== "done",
      at: Date.parse(ledger?.seenAt ?? "") || 0,
    });
  };
  for (const thread of input.local) if (thread.project === input.project) add(thread, "here");
  if (input.teammates)
    for (const thread of input.remote)
      if (thread.email !== input.email || thread.environment !== input.environment)
        add(thread, "origin");
  subjects.sort(
    (a, b) =>
      Number(b.where === "here") - Number(a.where === "here") ||
      Number(b.live) - Number(a.live) ||
      b.at - a.at ||
      a.branch.localeCompare(b.branch),
  );
  const unique = [
    ...new Map(subjects.toReversed().map((subject) => [subject.branch, subject])).values(),
  ].toReversed();
  return {
    subjects: unique.slice(0, MAX_BRANCHES),
    skipped: Math.max(0, unique.length - MAX_BRANCHES),
  };
}
/**
 * Every unordered pair within the limits. Notices to agents need one side on this computer; the
 * integration preview (`team`) pairs a teammate's work with another teammate's too.
 */
export function pairsOf(subjects: ReadonlyArray<Subject>, options: { team?: boolean } = {}) {
  const pairs: Array<{ a: Subject; b: Subject }> = [];
  for (let i = 0; i < subjects.length; i++)
    for (let j = i + 1; j < subjects.length; j++) {
      const a = subjects[i]!,
        b = subjects[j]!;
      if (
        a.branch !== b.branch &&
        (options.team === true || a.where === "here" || b.where === "here") &&
        a.workspace === b.workspace &&
        a.project === b.project &&
        a.repository === b.repository
      )
        pairs.push({ a, b });
    }
  return pairs.slice(0, MAX_PAIRS);
}
