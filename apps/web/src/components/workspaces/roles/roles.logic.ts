import { personName } from "@t3tools/client-runtime/peer/needs-you";
import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import {
  canStartReview,
  isAdvisory,
  roleDetail,
  roleLabel,
  reviewHarness,
  threadRole,
} from "@t3tools/client-runtime/peer/roles";
import type { PeerHubStatus, PeerRoleRow, PeerRolesStartReviewInput } from "@t3tools/contracts";

import type {
  PeerNavigate,
  TaskSlotProps,
  TeamPluginSignal,
  TeamSlotInput,
  TeamTaskFact,
  TeamTaskSlotInput,
} from "../slots.types";
import { taskLabel } from "../workTree.logic";

/** A review to start on a task: what the Hub is asked, and how the task is named in feedback. */
export interface ReviewLaunch {
  readonly input: PeerRolesStartReviewInput;
  readonly label: string;
}

/**
 * The review Start a review would start on a task, or null where none is offered: the plugin is
 * inactive, the task is done, or no checkout of the project is ready here. It runs in the
 * repository the launcher picks first and in the harness the task was last built in.
 */
export function reviewLaunch(
  props: Pick<TaskSlotProps, "status" | "workspace" | "project" | "task">,
): ReviewLaunch | null {
  const { project, task } = props;
  if (project === undefined || !canStartReview(props.status, task)) return null;
  const repository = project.repositories.find((repo) => repo.state === "ready");
  if (repository === undefined) return null;
  return {
    input: {
      workspace: props.workspace,
      projectId: project.project.id,
      taskId: task.id,
      repositoryId: repository.id,
      harness: reviewHarness(task.threads),
    },
    label: taskLabel(task),
  };
}

/**
 * What to ask before a further review of a task, or null for its first. It counts the chats the
 * task shows as reviewing, so a finished review still counts: starting again repeats its work.
 */
export function anotherReviewQuestion(
  props: Pick<TaskSlotProps, "status" | "task">,
): string | null {
  const count = props.task.threads.filter(
    (thread) => threadRole(props.status, thread)?.role === "review",
  ).length;
  if (count === 0) return null;
  const reviews = count === 1 ? "a review chat" : `${count} review chats`;
  return `${taskLabel(props.task)} already has ${reviews}. Start another? It repeats the check in a new chat and checkout.`;
}

type TaskRolesStatus = Pick<PeerHubStatus, "plugins" | "roles" | "mcp" | "coordination" | "email">;
type TaskPlace = { readonly workspace: string; readonly project: string; readonly task: string };

/** The line a review session that changed files through the shell carries. */
export const CHANGED_FILES_LINE =
  "Its files changed through the shell; a review session should revert them.";

/**
 * The Hub's role rows of a task's sessions, newest first: the project's rows whose sessions
 * coordination reports on the task, each with whether Peer cannot stop its edits.
 */
function rowsOnTask(status: TaskRolesStatus, place: TaskPlace) {
  if (!activePlugin(status, "roles")) return [];
  const onTask = new Map(
    status.coordination.sessions
      .filter(
        (session) =>
          session.workspace === place.workspace &&
          session.project === place.project &&
          session.task === place.task,
      )
      .map((session) => [session.id, session] as const),
  );
  return (status.roles?.projects ?? [])
    .filter((project) => project.workspace === place.workspace && project.project === place.project)
    .flatMap((project) => project.roles)
    .filter((row) => onTask.has(row.session))
    .toSorted((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
    .map((row) => ({
      row,
      label: onTask.get(row.session)?.label ?? row.session,
      advisory: isAdvisory({ session: row.session, mcpSessions: status.mcp?.sessions }),
      changedFiles: row.changedFiles === true,
    }));
}

/** One session on a task with a role, as the task page's Review sessions section lists it. */
export interface TaskRoleRow {
  readonly key: string;
  /** "You", the member's name, or their address when the project does not list them. */
  readonly who: string;
  /** What the session is, as coordination labels it. */
  readonly session: string;
  /** "reviewing", or "reviewing · advisory" where Peer cannot stop its edits. */
  readonly label: string;
  /** What the role means for this session; the changed-files line stands apart. */
  readonly detail: string;
  readonly advisory: boolean;
  /** The Hub says its files changed through the shell while it had the role. */
  readonly changedFiles: boolean;
}

/**
 * The sessions on a task that have a role, newest first, the same words the phone shows. A
 * colleague's session reads the same as one's own.
 */
export function taskRoleRows(
  status: TaskRolesStatus,
  place: TaskPlace,
  members: ReadonlyArray<{ readonly email: string; readonly name: string }>,
): ReadonlyArray<TaskRoleRow> {
  return rowsOnTask(status, place).map(({ row, label, advisory, changedFiles }) => {
    const mine = status.email !== null && row.email.toLowerCase() === status.email.toLowerCase();
    return {
      key: row.session,
      who: mine
        ? "You"
        : (members.find((member) => member.email.toLowerCase() === row.email.toLowerCase())?.name ??
          row.email),
      session: label,
      label: roleLabel(row.role, advisory),
      detail: roleDetail(row.role, { advisory, changedFiles: false, pending: false }),
      advisory,
      changedFiles,
    };
  });
}

const openTask = (workspace: string, project: string, task: string) => (navigate: PeerNavigate) =>
  void navigate({ to: "/task/$workspace/$project/$task", params: { workspace, project, task } });

const namesOf = (status: PeerHubStatus, workspace: string, rows: ReadonlyArray<PeerRoleRow>) =>
  [...new Set(rows.map((row) => personName(status, workspace, row.email)))].join(", ");

/**
 * A task's review sessions on its row of the Team page: "reviewing · Slavo", "reviewing ·
 * advisory · Ana", or "reviewing · changed files" when one changed files through the shell. It
 * names people only: a session's label stays off the Team page.
 */
export function teamTaskFacts(input: TeamTaskSlotInput): TeamTaskFact | undefined {
  const { status, project, task } = input;
  const rows = rowsOnTask(status, {
    workspace: project.workspace,
    project: project.projectId,
    task: task.id,
  });
  const newest = rows[0];
  if (newest === undefined) return undefined;
  const changed = rows.some((entry) => entry.changedFiles);
  const label = roleLabel(
    newest.row.role,
    rows.some((entry) => entry.advisory),
  );
  return {
    id: "roles",
    text: changed
      ? `${label} · changed files`
      : `${label} · ${namesOf(
          status,
          project.workspace,
          rows.map((entry) => entry.row),
        )}`,
    tone: changed ? "needs" : "team",
    open: openTask(project.workspace, project.projectId, task.id),
  };
}

const taskName = (task: { readonly key?: string | undefined; readonly title: string }) =>
  task.key === undefined || task.key === "" ? task.title : task.key;

/**
 * One signal per task where a review session changed files through the shell: a review should
 * leave the work as it found it, so a person looks at what changed and has it reverted.
 */
export function teamSignals(input: TeamSlotInput): ReadonlyArray<TeamPluginSignal> {
  const { status, project } = input;
  return project.tasks.flatMap((task) => {
    const changed = rowsOnTask(status, {
      workspace: project.workspace,
      project: project.projectId,
      task: task.id,
    }).filter((entry) => entry.changedFiles);
    const newest = changed[0];
    if (newest === undefined) return [];
    const who = namesOf(
      status,
      project.workspace,
      changed.map((entry) => entry.row),
    );
    return [
      {
        id: `changed-files:${task.id}`,
        what: `${taskName(task)}: a review session changed files`,
        detail: `${who}’s review session changed files through the shell; a review session should revert them`,
        since: newest.row.at,
        action: {
          label: "Open task",
          open: openTask(project.workspace, project.projectId, task.id),
        },
      },
    ];
  });
}
