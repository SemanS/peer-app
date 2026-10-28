/**
 * What Test reports says on the web beyond the task page: the fact on a task's row of the Team page
 * and the signals for unverified items nobody answers for, from the status's summaries alone. The
 * words are the client runtime's (`peer/test-reports`), shared with the phone. Pure, so a test
 * reads exactly what the page shows.
 */
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import {
  canAssignOwners,
  newestSummary,
  teamFact,
} from "@t3tools/client-runtime/peer/test-reports";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { PeerHubStatus, PeerTask, PeerTestReportSummary } from "@t3tools/contracts";

import type {
  PeerNavigate,
  TeamPluginSignal,
  TeamSlotInput,
  TeamTaskFact,
  TeamTaskSlotInput,
} from "../slots.types";

const openTask = (workspace: string, project: string, task: string) => (navigate: PeerNavigate) =>
  void navigate({ to: "/task/$workspace/$project/$task", params: { workspace, project, task } });

/** The newest report of a task on the Team page: its result, and the items waiting for an owner. */
export function teamTaskFacts(input: TeamTaskSlotInput): TeamTaskFact | undefined {
  const { status, project, task } = input;
  const newest = newestSummary(status, {
    workspace: project.workspace,
    project: project.projectId,
    task: task.id,
  });
  if (newest === undefined) return undefined;
  const fact = teamFact(newest);
  return {
    id: "test-reports",
    text: fact.text,
    tone: fact.needsOwner ? "needs" : "neutral",
    open: openTask(project.workspace, project.projectId, task.id),
  };
}

const taskName = (tasks: ReadonlyArray<Pick<PeerTask, "id" | "key" | "title">>, id: string) => {
  const task = tasks.find((candidate) => candidate.id === id);
  return task === undefined
    ? id
    : task.key === undefined || task.key === ""
      ? task.title
      : task.key;
};

const waiting = (n: number) =>
  n === 1 ? "1 unverified item needs an owner" : `${n} unverified items need an owner`;

/**
 * One signal per task of the project whose newest report has unverified items without an owner: a
 * person has to say who checks them before the task's agent may finish it.
 */
export function teamSignals(input: TeamSlotInput): ReadonlyArray<TeamPluginSignal> {
  const { status, project } = input;
  return project.tasks.flatMap((task) => {
    const newest = newestSummary(status, {
      workspace: project.workspace,
      project: project.projectId,
      task: task.id,
    });
    if (newest === undefined || newest.unowned === 0) return [];
    const name = taskName(project.tasks, task.id);
    return [
      {
        id: `unowned:${task.id}`,
        what: `${name}: ${waiting(newest.unowned)}`,
        detail: `Test report ${newest.number} by ${personName(status, project.workspace, newest.author)} is ${newest.result}; its agent cannot finish the task until each item has an owner`,
        since: newest.at,
        action: {
          label: "Open task",
          open: openTask(project.workspace, project.projectId, task.id),
        },
      },
    ];
  });
}

/** The task page's view of who may give items an owner, from the status the page read. */
export function assignRights(
  status: Pick<PeerHubStatus, "workspaces" | "ownership" | "email">,
  place: { readonly workspace: string; readonly project: string; readonly task: string },
): boolean {
  const workspace = status.workspaces.find((candidate) => candidate.slug === place.workspace);
  const state = workspace?.projects.find((candidate) => candidate.project.id === place.project);
  if (workspace === undefined || state === undefined) return false;
  const area = state.work.tasks.find((task) => task.id === place.task)?.area;
  return canAssignOwners(status, workspace, state.project, {
    id: place.task,
    ...(area === undefined ? {} : { area }),
  });
}

/** Who wrote a report, as its row names them: "You", "Ana", "Slavo · review". */
export function authorLine(
  report: Pick<PeerTestReportSummary, "author" | "role">,
  me: string | null,
  name: (email: string) => string,
): string {
  const who =
    me !== null && report.author.toLowerCase() === me.toLowerCase() ? "You" : name(report.author);
  return report.role === "review" ? `${who} · review session` : who;
}

/** Why a change did not happen, in the Hub's words; null for a success or a cancelled one. */
export function reportFailure(result: AtomCommandResult<unknown, unknown>): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const cause = squashAtomCommandFailure(result);
  if (typeof cause === "object" && cause !== null && "detail" in cause) {
    return String((cause as { readonly detail: unknown }).detail);
  }
  return cause instanceof Error ? cause.message : String(cause);
}
