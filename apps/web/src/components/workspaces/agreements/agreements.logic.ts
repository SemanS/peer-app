/**
 * What Agreements says on the web, worked out from the status field and the view the Hub served:
 * which due agreements wait on the person (Needs you), how a task's context page lists its
 * agreements, and what the Team page adds to a task's row and to its signals. Pure, with `now`
 * passed in, so a label never depends on the clock it renders on. The rules themselves (which
 * agreements are a task's, whether a person may close or reopen one, the words of a state) are the
 * client runtime's, shared with the phone: `peer/agreements`.
 */
import {
  agreementStateLabel,
  agreementsOfTask,
  canClose,
  canReopen,
  otherTask,
} from "@t3tools/client-runtime/peer/agreements";
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  PeerHubError,
  type PeerAgreement,
  type PeerAgreementsStatus,
  type PeerAgreementsView,
  type PeerHubStatus,
  type PeerTask,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { SignalTone } from "../signals";
import type {
  PeerNavigate,
  TeamPluginSignal,
  TeamSlotInput,
  TeamTaskFact,
  TeamTaskSlotInput,
} from "../slots.types";
import { agoLabel } from "../task/taskTime.logic";
import { taskLabel, type WorkProjectNode, type WorkThreadNode } from "../workTree.logic";

type TaskNames = ReadonlyArray<Pick<PeerTask, "id" | "key" | "title">>;
type View = Pick<PeerAgreementsView, "agreements">;

const isPeerHubError = Schema.is(PeerHubError);

// ---- naming things ---------------------------------------------------------------------------------

/**
 * A task as a sentence names it: its key, else its title. A task the project no longer lists stays
 * as its id, since an agreement outlives a task until the Hub's sweep closes it.
 */
function taskName(tasks: TaskNames, id: string): string {
  const task = tasks.find((candidate) => candidate.id === id);
  if (task === undefined) return id;
  return task.key === undefined || task.key === "" ? task.title : task.key;
}

/** A task as a list names it: `KRK-2 · Loyalty points`. */
function taskTitle(tasks: TaskNames, id: string): string {
  const task = tasks.find((candidate) => candidate.id === id);
  return task === undefined ? id : taskLabel(task);
}

/** A project's tasks as the status lists them: what an agreement's task ids are named by. */
export function projectTasks(
  status: Pick<PeerHubStatus, "workspaces">,
  workspace: string,
  project: string,
): ReadonlyArray<PeerTask> {
  return (
    status.workspaces
      .find((candidate) => candidate.slug === workspace)
      ?.projects.find((candidate) => candidate.project.id === project)?.work.tasks ?? []
  );
}

/** Who is looking, and how a teammate is named: where "Bob’s agent" and "handled by you" come from. */
export interface People {
  /** The viewer's address in lower case; null while signed out. */
  readonly me: string | null;
  readonly name: (email: string) => string;
}

export function peopleOf(status: PeerHubStatus, workspace: string): People {
  return {
    me: status.email === null ? null : status.email.toLowerCase(),
    name: (email) => personName(status, workspace, email),
  };
}

/** Whose agent settled it: "your agent" for the person looking, else "Bob’s agent". */
const agentOf = (email: string, people: People) =>
  people.me === email.toLowerCase() ? "your agent" : `${people.name(email)}’s agent`;

const personLabel = (people: People) => (email: string) =>
  people.me === email.toLowerCase() ? "you" : people.name(email);

/** Who settled an agreement, when, and on which task: "Settled yesterday by Bob’s agent on KRK-2". */
function settledLine(
  agreement: PeerAgreement,
  input: { readonly tasks: TaskNames; readonly people: People; readonly now: number },
): string {
  const { tasks, people, now } = input;
  const when = agoLabel(agreement.settledAt, now);
  const on = agreement.by.task === "" ? "" : ` on ${taskName(tasks, agreement.by.task)}`;
  return `Settled${when === "" ? "" : ` ${when}`} by ${agentOf(agreement.by.email, people)}${on}`;
}

/** The state's words, and, once it closed, when: "Closed · handled by Ana · yesterday". */
function stateLine(
  agreement: PeerAgreement,
  input: { readonly tasks: TaskNames; readonly people: People; readonly now: number },
): string {
  const { tasks, people, now } = input;
  const label = agreementStateLabel(agreement, (id) => taskName(tasks, id), personLabel(people));
  const closedAt =
    agreement.state === "closed" && agreement.closed !== undefined
      ? agoLabel(agreement.closed.at, now)
      : "";
  return closedAt === "" ? label : `${label} · ${closedAt}`;
}

/** What kind of conversation an agreement's state is: due waits on a person, the rest read quietly. */
const stateTone = (agreement: Pick<PeerAgreement, "state">): SignalTone =>
  agreement.state === "due" ? "needs" : "neutral";

/** The task of a due agreement that landed: the other of its pair than the one it waits on. */
function landedTask(agreement: PeerAgreement): string | undefined {
  return (
    (agreement.dueFor === undefined ? undefined : otherTask(agreement, agreement.dueFor)) ??
    agreement.landed[0]
  );
}

/** "Agreement due — KRK-1 landed": a card's first line and a Team row's fact say it alike. */
const dueLine = (tasks: TaskNames, landed: string | undefined) =>
  landed === undefined ? "Agreement due" : `Agreement due — ${taskName(tasks, landed)} landed`;

const settledMs = (agreement: PeerAgreement) => {
  const at = Date.parse(agreement.settledAt);
  return Number.isFinite(at) ? at : 0;
};

/** Newest settled first; the same moment falls back to the id, so every view orders alike. */
const newestFirst = (a: PeerAgreement, b: PeerAgreement) =>
  settledMs(b) - settledMs(a) || a.id.localeCompare(b.id);

// ---- Needs you ---------------------------------------------------------------------------------------

/** The due agreements of one project that wait on the person, by id: the status field's `dueForMe`. */
export interface DueGroup {
  readonly workspace: string;
  readonly project: string;
  readonly ids: ReadonlyArray<string>;
}

/**
 * What waits on the person, a group per project. The status field decides what waits (it knows
 * which tasks have a live agent); the Hub's view only says what each one is.
 */
export function dueForMeGroups(status: Pick<PeerHubStatus, "agreements">): ReadonlyArray<DueGroup> {
  const groups = new Map<string, { workspace: string; project: string; ids: string[] }>();
  for (const row of status.agreements?.workspaces ?? []) {
    for (const due of row.dueForMe) {
      const key = JSON.stringify([row.workspace, due.project]);
      const group = groups.get(key) ?? { workspace: row.workspace, project: due.project, ids: [] };
      if (!group.ids.includes(due.id)) group.ids.push(due.id);
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}

/** How many due agreements wait on the person, across workspaces: what Needs you counts. */
export const dueForMeCount = (status: Pick<PeerHubStatus, "agreements">): number =>
  dueForMeGroups(status).reduce((total, group) => total + group.ids.length, 0);

/** One due agreement as its Needs you card says it. */
export interface DueCard {
  readonly key: string;
  readonly workspace: string;
  readonly project: string;
  readonly id: string;
  /** The task that has not landed: what the card is about and what "Open task" opens. */
  readonly task: string;
  /** "Agreement due — KRK-1 landed". */
  readonly state: string;
  /** "KRK-2 · Loyalty points". */
  readonly title: string;
  /** "Settled yesterday by your agent on KRK-2". */
  readonly settled: string;
  /** The words as the agents wrote them: plain text, never markup. */
  readonly words: string;
}

/**
 * The cards of a group, newest settled first: each agreement of the group that the Hub's view says
 * is still due. An agreement the view does not hold yet, or holds as closed or not due, has no
 * card, so a card never outlives the Hub's word.
 */
export function dueCards(input: {
  readonly group: DueGroup;
  readonly view: View | undefined;
  readonly tasks: TaskNames;
  readonly people: People;
  readonly now: number;
}): ReadonlyArray<DueCard> {
  const { group, tasks, people, now } = input;
  const waiting = new Set(group.ids);
  return (input.view?.agreements ?? [])
    .filter((agreement) => agreement.project === group.project && waiting.has(agreement.id))
    .toSorted(newestFirst)
    .flatMap((agreement): ReadonlyArray<DueCard> => {
      const { dueFor } = agreement;
      if (agreement.state !== "due" || dueFor === undefined) return [];
      return [
        {
          key: `${group.workspace}/${group.project}/${agreement.id}`,
          workspace: group.workspace,
          project: group.project,
          id: agreement.id,
          task: dueFor,
          state: dueLine(tasks, landedTask(agreement)),
          title: taskTitle(tasks, dueFor),
          settled: settledLine(agreement, { tasks, people, now }),
          words: agreement.words,
        },
      ];
    });
}

// ---- a task's page -----------------------------------------------------------------------------------

/** One agreement as a task's context page lists it. */
export interface AgreementRow {
  readonly id: string;
  /** The other task of the pair; undefined only for an agreement that does not name the task. */
  readonly other:
    | {
        readonly id: string;
        /** "KRK-1 · Rounding". */
        readonly label: string;
        /** The project still lists it, so its page opens. */
        readonly known: boolean;
      }
    | undefined;
  /** "Open", "Due — KRK-1 landed", "Closed · handled by Ana · yesterday". */
  readonly state: string;
  readonly tone: SignalTone;
  readonly settled: string;
  readonly words: string;
  readonly canClose: boolean;
  readonly canReopen: boolean;
}

/**
 * The task's agreements in the order its page lists them: those not closed first, then the closed
 * ones, newest settled first. Close is offered to an open or due one, Reopen to one a person
 * closed while no task landed and the 30 days last.
 */
export function agreementRows(input: {
  readonly view: View | undefined;
  readonly project: string;
  readonly task: string;
  readonly tasks: TaskNames;
  readonly people: People;
  readonly now: number;
}): ReadonlyArray<AgreementRow> {
  const { tasks, people, now } = input;
  return agreementsOfTask(input.view, input.project, input.task).map((agreement) => {
    const other = otherTask(agreement, input.task);
    return {
      id: agreement.id,
      other:
        other === undefined
          ? undefined
          : {
              id: other,
              label: taskTitle(tasks, other),
              known: tasks.some((candidate) => candidate.id === other),
            },
      state: stateLine(agreement, { tasks, people, now }),
      tone: stateTone(agreement),
      settled: settledLine(agreement, { tasks, people, now }),
      words: agreement.words,
      canClose: canClose(agreement),
      canReopen: canReopen(agreement, now),
    };
  });
}

/** Why a close or a reopen did not happen, for the card or row that asked. */
export interface AgreementFailure {
  readonly message: string;
  /** The agreement is no longer as the person saw it: read it again. */
  readonly stale: boolean;
}

/**
 * What a failed close or reopen says: the Hub's own words, except for a refusal of the agreement's
 * state (closed by someone else, a task landed meanwhile), which every client says the same way.
 * Null when it did not fail, or the person interrupted it.
 */
export function agreementFailure(
  result: AtomCommandResult<unknown, unknown>,
): AgreementFailure | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const cause = squashAtomCommandFailure(result);
  if (isPeerHubError(cause) && cause.code === "agreement_state") {
    return {
      message: "This agreement changed since you opened it, so nothing was done.",
      stale: true,
    };
  }
  return { message: cause instanceof Error ? cause.message : String(cause), stale: false };
}

// ---- the Team page -----------------------------------------------------------------------------------

type WorkspaceAgreements = PeerAgreementsStatus["workspaces"][number];

const workspaceRow = (
  status: Pick<PeerHubStatus, "agreements">,
  workspace: string,
): WorkspaceAgreements | undefined =>
  status.agreements?.workspaces.find((candidate) => candidate.workspace === workspace);

/**
 * Whether an agent is live on a task, as the work tree has it: one of its chats that has not been
 * left behind (its computer reports it), is not delivered and is not settled. A chat whose state
 * nobody can tell counts, since its agent would hear the agreement at its next step.
 */
export function hasLiveAgent(project: Pick<WorkProjectNode, "areas">, task: string): boolean {
  const live = (thread: WorkThreadNode) =>
    !thread.stale &&
    thread.delivery !== "merged" &&
    thread.delivery !== "closed" &&
    thread.status !== "done";
  return project.areas.some((area) =>
    area.tasks.some((candidate) => candidate.id === task && candidate.threads.some(live)),
  );
}

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;

/**
 * The one fact on a task's Team row while it has an agreement not closed, without the words. An
 * agreement due on the task says so and names the task that landed ("Agreement due — KRK-1
 * landed"), in the tone of what waits on a person while no agent works on the task, and quietly
 * while one does, since it hears the agreement at its next step. The status field counts agreements
 * per task and names the two tasks of a due one only, so an open agreement says no more than that it
 * is open, except for the task that landed, whose partner the due list names. The fact opens the
 * task's context page, where the agreements are listed.
 */
export function agreementFact(input: TeamTaskSlotInput): TeamTaskFact | undefined {
  const { status, project, task } = input;
  const row = workspaceRow(status, project.workspace);
  const counts = row?.tasks?.find(
    (candidate) => candidate.project === project.projectId && candidate.task === task.id,
  );
  if (counts === undefined || counts.open === 0) return undefined;
  const due = (row?.due ?? []).filter((entry) => entry.project === project.projectId);
  const waiting = due.filter((entry) => entry.dueFor === task.id);
  const partners = due.filter((entry) => entry.landed === task.id);
  const open = (navigate: PeerNavigate) =>
    void navigate({
      to: "/context/$workspace/$project/$scope",
      params: {
        workspace: project.workspace,
        project: project.projectId,
        scope: `task:${task.id}`,
      },
    });
  const fact = (text: string, tone: SignalTone): TeamTaskFact => ({
    id: "agreements",
    text,
    tone,
    open,
  });
  if (counts.due > 0) {
    const landed = waiting.length === 1 ? waiting[0]?.landed : undefined;
    return fact(
      counts.due === 1 ? dueLine(project.tasks, landed) : `${plural(counts.due, "agreement")} due`,
      hasLiveAgent(project, task.id) ? "neutral" : "needs",
    );
  }
  const partner = counts.open === 1 && partners.length === 1 ? partners[0] : undefined;
  return fact(
    partner === undefined
      ? counts.open === 1
        ? "Agreement open"
        : `${plural(counts.open, "agreement")} open`
      : `Agreement with ${taskName(project.tasks, partner.dueFor)} — due there`,
    "neutral",
  );
}

/**
 * One signal for each agreement due on a task of the project that no agent works on: nobody would
 * hear it, so a person has to. An agent at work on the task hears it at its next step, so that is
 * no signal. The row's fact and Needs you carry the rest.
 */
export function agreementSignals(input: TeamSlotInput): ReadonlyArray<TeamPluginSignal> {
  const { status, project } = input;
  return (workspaceRow(status, project.workspace)?.due ?? []).flatMap((entry) => {
    const listed = project.tasks.some((candidate) => candidate.id === entry.dueFor);
    if (entry.project !== project.projectId || !listed || hasLiveAgent(project, entry.dueFor)) {
      return [];
    }
    const name = taskName(project.tasks, entry.dueFor);
    return [
      {
        id: `due:${entry.id}`,
        what: `${name} has an agreement due`,
        detail: `${taskName(project.tasks, entry.landed)} landed; nobody works on ${name}`,
        action: {
          label: "Open task",
          open: (navigate) =>
            void navigate({
              to: "/task/$workspace/$project/$task",
              params: {
                workspace: project.workspace,
                project: project.projectId,
                task: entry.dueFor,
              },
            }),
        },
      },
    ];
  });
}
