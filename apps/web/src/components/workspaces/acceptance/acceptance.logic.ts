/**
 * What the acceptance plugin's web slots show, decided apart from the components: the facts of a
 * task (where it stands, who may accept, what they may do), its card on the task page, and its fact
 * on the Team page. A done task without acceptance is said plainly: acceptance gates nothing.
 */
import {
  acceptanceActions,
  acceptanceState,
  acceptedAtLabel,
  acceptedLine,
  currentOf,
  historyLine,
  historyNewestFirst,
  mayAccept,
  personName,
  taskAcceptance,
  teamAcceptanceFact,
  type AcceptanceState,
  type DeliveryStatus,
} from "@t3tools/client-runtime/peer/acceptance";
import type {
  PeerAcceptanceSummary,
  PeerHubStatus,
  PeerTask,
  PeerTaskAcceptance,
} from "@t3tools/contracts";

import type { PeerNavigate, TeamTaskFact, TeamTaskSlotInput } from "../slots.types";

export interface AcceptancePlace {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}

/** A task as acceptance sees it, read from the status by ids. */
export interface AcceptanceFacts {
  readonly place: AcceptancePlace;
  /** VL7, or the title of a task without a key. */
  readonly taskName: string;
  readonly delivery: DeliveryStatus;
  readonly current: PeerAcceptanceSummary | undefined;
  readonly state: AcceptanceState;
  /** A lead of the project or an admin, on a connection that may send the command. */
  readonly mayAct: boolean;
  /** Accept and withdraw as this person may use them now. */
  readonly actions: ReadonlyArray<"accept" | "withdraw">;
  readonly nameOf: (email: string) => string;
}

const taskName = (task: Pick<PeerTask, "key" | "title">) =>
  task.key === undefined || task.key === "" ? task.title : task.key;

/**
 * The facts of a task, or undefined where the status does not list it. `allowed` is whether this
 * connection may send the command at all; the Hub decides again.
 */
export function acceptanceFacts(
  status: Pick<PeerHubStatus, "workspaces" | "acceptance">,
  place: AcceptancePlace,
  allowed = true,
): AcceptanceFacts | undefined {
  const workspace = status.workspaces.find((candidate) => candidate.slug === place.workspace);
  const state = workspace?.projects.find((candidate) => candidate.project.id === place.project);
  const task = state?.work.tasks.find((candidate) => candidate.id === place.task);
  if (workspace === undefined || state === undefined || task === undefined) return undefined;
  const delivery: DeliveryStatus = task.status ?? "open";
  const current = taskAcceptance(status, place);
  const mayAct = allowed && mayAccept(workspace, state.project);
  return {
    place,
    taskName: taskName(task),
    delivery,
    current,
    state: acceptanceState(current, delivery),
    mayAct,
    actions: acceptanceActions({ allowed: mayAct, current, task: delivery }),
    nameOf: (email) => personName(status, place.workspace, email),
  };
}

/** One line of the card's history, with the note its author gave. */
export interface HistoryRow {
  readonly key: string;
  readonly line: string;
  readonly note: string | undefined;
}

/** The task page's acceptance card. */
export interface AcceptanceCard {
  readonly heading: string;
  /** The current acceptance's note. */
  readonly note: string | undefined;
  /** A line under the heading: what the state means, for the states that need one. */
  readonly hint: string | undefined;
  readonly tone: "accepted" | "quiet";
  readonly history: ReadonlyArray<HistoryRow>;
  readonly actions: ReadonlyArray<"accept" | "withdraw">;
}

/**
 * The card, or null where it has nothing to say: an open task never accepted, which nobody may
 * accept yet. `view` is the page's read of the task (with notes and history); until it arrives
 * the status's summary stands in for it.
 */
export function acceptanceCard(
  facts: AcceptanceFacts,
  view: PeerTaskAcceptance | undefined,
  clock: (at: string) => string = acceptedAtLabel,
): AcceptanceCard | null {
  const current = view === undefined ? facts.current : currentOf(view);
  const state = acceptanceState(current, facts.delivery);
  const history = historyNewestFirst(view?.history ?? []).map((event, index) => ({
    key: `${event.at}:${event.kind}:${index}`,
    line: historyLine(event, facts.nameOf, clock),
    note: event.note === undefined || event.note.trim() === "" ? undefined : event.note,
  }));
  // The page's read may be a moment ahead of the status (a withdrawal read before the status
  // moved): what the person may do follows the read.
  const actions = acceptanceActions({ allowed: facts.mayAct, current, task: facts.delivery });
  if (state === "none" && history.length === 0 && actions.length === 0) return null;
  const heading =
    current !== undefined
      ? acceptedLine(current, facts.delivery, facts.nameOf, clock)
      : state === "not-accepted"
        ? "Done · not accepted"
        : facts.delivery === "review"
          ? "In review · not accepted yet"
          : "Not accepted";
  const hint =
    state === "accepted-before-reopening"
      ? facts.delivery === "open"
        ? "Given before the task was reopened. Withdraw it, and accept the work again once it is delivered."
        : "Given before the task was reopened. It is delivered again: accept the work again, or withdraw it."
      : state === "not-accepted"
        ? "The task is done; a lead of the project can still accept the work."
        : state === "none" && facts.delivery === "review"
          ? "Accepting it moves the task to done as the lead's own move."
          : undefined;
  return {
    heading,
    note: current !== undefined && "note" in current ? nonEmpty(current.note) : undefined,
    hint,
    tone: current === undefined ? "quiet" : "accepted",
    history,
    actions,
  };
}

const nonEmpty = (text: string | undefined) =>
  text === undefined || text.trim() === "" ? undefined : text;

const openTask = (workspace: string, project: string, task: string) => (navigate: PeerNavigate) =>
  void navigate({ to: "/task/$workspace/$project/$task", params: { workspace, project, task } });

/** The Team page's fact on a task's row: "accepted by Ana", or "done · not accepted". */
export function teamTaskFacts(input: TeamTaskSlotInput): TeamTaskFact | undefined {
  const { status, project, task } = input;
  const row = project.tasks.find((candidate) => candidate.id === task.id);
  const place = { workspace: project.workspace, project: project.projectId, task: task.id };
  const text = teamAcceptanceFact(taskAcceptance(status, place), row?.status ?? "open", (email) =>
    personName(status, project.workspace, email),
  );
  if (text === undefined) return undefined;
  return {
    id: "acceptance",
    text,
    tone: text.startsWith("accepted") ? "delivery" : "neutral",
    open: openTask(place.workspace, place.project, place.task),
  };
}
