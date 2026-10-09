/**
 * The work report: this computer's threads as each workspace hears of them, and the work Peer
 * reads back. Plain functions over what PeerWork gathered; PeerWork sends what they build.
 *
 * @module peerHub/core/work/report
 */
import type { PeerProject, PeerTask, PeerWorkStatus } from "@t3tools/contracts";

import {
  boundedWorkReport,
  mergePullRequestEvidence,
  pullRequestBatch,
  restoreWorkIdentity,
} from "../../workLifecycle.ts";
import type { HubWork, ReportedThread } from "../hub/hubApi.ts";
import type { PeerGitHost } from "../plugin.ts";
import { projectKey, type PersistedState, type ProjectWork } from "../state/PeerState.ts";

const ACTIVE_RUN_STATES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

/** A thread's state as the work view shows it: ◐ blocked on an answer, ● working, ✓ done, ○ idle. */
export function shellStatus(thread: {
  readonly status: string;
  readonly activityRunStatus?: string | null | undefined;
  readonly pendingRuntimeRequest: unknown;
  readonly settledAt: unknown;
}): PeerWorkStatus {
  if (thread.pendingRuntimeRequest !== null) return "blocked";
  if (ACTIVE_RUN_STATES.has(thread.activityRunStatus ?? thread.status)) return "working";
  return thread.settledAt !== null ? "done" : "idle";
}

/** The task one of this computer's threads was put on in a workspace project, if any. */
export function assignedTask(
  persisted: PersistedState,
  thread: string,
  workspace: string,
  projectId: string,
): string | undefined {
  const assignment = persisted.assignments?.[thread];
  return assignment !== undefined &&
    assignment.workspace === workspace &&
    assignment.project === projectId
    ? assignment.task
    : undefined;
}

/** A project's tasks as the Hub last said. */
export const tasksOf = (
  work: ReadonlyMap<string, ProjectWork>,
  workspace: string,
  projectId: string,
): ReadonlyArray<PeerTask> => work.get(projectKey(workspace, projectId))?.tasks ?? [];

/** A task as people name it (`KRK-335 · DNS errors`), or its id when Peer does not know it. */
export function taskName(
  work: ReadonlyMap<string, ProjectWork>,
  workspace: string,
  projectId: string,
  task: string,
): string {
  const found = tasksOf(work, workspace, projectId).find((candidate) => candidate.id === task);
  if (found === undefined) return task;
  return found.key === undefined ? found.title : `${found.key} · ${found.title}`;
}

/** One workspace's work as the Hub gave it, keyed like `RuntimeState.work`. */
export const workOf = (slug: string, fetched: HubWork) =>
  Object.entries(fetched.projects).map(
    ([projectId, projectWork]) =>
      [
        projectKey(slug, projectId),
        {
          areas: projectWork.areas,
          tasks: projectWork.tasks,
          // The ledger includes our absent runtimes too; clients overlay their live threads.
          threads: projectWork.threads,
        },
      ] as const,
  );

/**
 * What this computer tells one workspace of its threads: its live ones (Peer's own, then its
 * runtime's) with what plugins add to each, the work it reported before and no longer runs (the Hub
 * keeps it through a restart), and pull-request evidence, within the wire's bound.
 */
export function workspaceReport(input: {
  readonly workspace: string;
  readonly projects: ReadonlyArray<PeerProject>;
  readonly persisted: PersistedState;
  readonly environmentId: string;
  /** The work as Peer last read it, before this report. */
  readonly previous: ReadonlyMap<string, ProjectWork>;
  readonly live: ReadonlyArray<ReportedThread>;
  /** Whether its owner lets the team watch a thread (observe). */
  readonly observable: (thread: string) => boolean;
  readonly gitHost: PeerGitHost | undefined;
  /** How many reports went before: dormant work takes turns within the bound. */
  readonly round: number;
}): ReadonlyArray<ReportedThread> {
  const { workspace, persisted, environmentId, previous } = input;
  const email = persisted.email;
  const ownBefore = (projectId: string) =>
    (previous.get(projectKey(workspace, projectId))?.threads ?? []).filter(
      (old) => old.email === email && old.environment === environmentId,
    );
  const reported: ReportedThread[] = input.live
    .map((thread) => (input.observable(thread.id) ? { ...thread, observable: true } : thread))
    .map((thread) => restoreWorkIdentity(thread, ownBefore(thread.project)));
  // Keep absent runtimes in the ledger and reconcile their registered PRs too.
  // The hub retains them through a restart before this computer has read its first view.
  for (const project of input.projects) {
    for (const thread of ownBefore(project.id)) {
      if (reported.some((current) => current.id === thread.id || current.previousId === thread.id))
        continue;
      if (thread.delivery === "merged" || thread.delivery === "closed") continue;
      const task = assignedTask(persisted, thread.id, workspace, project.id) ?? thread.task;
      reported.push({
        id: thread.id,
        project: project.id,
        title: thread.title,
        status: "unknown",
        source: thread.source,
        runtimePresent: false,
        observable: false,
        ...(task === undefined ? {} : { task }),
        ...(thread.branch === undefined ? {} : { branch: thread.branch }),
        ...(thread.harness === undefined ? {} : { harness: thread.harness }),
        ...(thread.repository === undefined ? {} : { repository: thread.repository }),
        ...(thread.pullRequests === undefined ? {} : { pullRequests: thread.pullRequests }),
      });
    }
  }
  return boundedWorkReport(reported, input.round).map((thread) => {
    const project = input.projects.find((p) => p.id === thread.project);
    const before = ownBefore(thread.project).find(
      (old) => old.id === thread.id && old.branch === thread.branch,
    );
    const repository = thread.repository ?? before?.repository;
    const repo = project?.repositories.find((r) => r.id === repository);
    const required = thread.pullRequests ?? before?.pullRequests;
    // Native threads already get host snapshots through their PR links. Runtime and dormant
    // threads use exact URLs once discovered; failed lookups leave hub evidence untouched.
    const observed =
      thread.source === "peer" &&
      thread.runtimePresent !== false &&
      thread.pullRequests !== undefined
        ? thread.pullRequests
        : repo === undefined ||
            thread.branch === undefined ||
            input.gitHost === undefined ||
            !input.gitHost.owns(repo.url)
          ? undefined
          : input.gitHost.pullRequests({
              workId: `${email}/${workspace}/${thread.project}/${thread.id}`,
              repositoryUrl: repo.url,
              branch: thread.branch,
              known: pullRequestBatch(required ?? [], thread.branch),
            });
    const pullRequests = mergePullRequestEvidence(required, observed);
    return {
      ...thread,
      ...(repository === undefined ? {} : { repository }),
      ...(pullRequests === undefined ? {} : { pullRequests }),
    };
  });
}
