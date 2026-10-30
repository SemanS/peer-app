/**
 * What a forecast pair's card offers for a change that is not right yet, and who does it. A pair's
 * `later` side is the change started later; its person builds on the other change or resolves the
 * conflict, so the card's actions go to that side. On the computer that runs an agent session of it
 * the action runs here; anywhere else the card asks the later side's person, through the request to
 * a teammate.
 */
import { taskNamedIn } from "@t3tools/client-runtime/peer/work";
import {
  runTaskOf,
  type JujutsuFollowResult,
  type JujutsuIntegrateInput,
  type PeerForecastPair,
  type PeerForecastSide,
  type PeerHubStatus,
  type PeerProjectState,
} from "@t3tools/contracts";

export interface PairTask {
  readonly id: string;
  readonly key?: string | undefined;
  readonly title: string;
}

/**
 * An agent session of the person on this computer, in a jj checkout, and the task it works on. The
 * session is named by the work tree's id for its thread (herdr's agent id), the same form the
 * Changes page sends, which the environment resolves to the running session and its workspace.
 */
export interface LocalSession {
  readonly taskId: string;
  readonly session: string;
}

export interface PairActionInput {
  readonly pair: PeerForecastPair;
  /** The project's tasks, to name a side by its key. */
  readonly tasks: ReadonlyArray<PairTask>;
  readonly sessions: ReadonlyArray<LocalSession>;
  /** This person's address. */
  readonly me: string | null;
  /** A teammate's name from their address: `bob@acme.test` is Bob. */
  readonly nameOf: (email: string) => string;
}

/** The task a request or launch is about. */
export interface PairActionTask {
  readonly id: string;
  readonly label: string;
}

export type PairAction =
  | { readonly kind: "none" }
  /** Runs here: moves the later side's agent onto the earlier side's change. */
  | {
      readonly kind: "build";
      readonly label: string;
      readonly session: string;
      readonly onto: PairActionTask;
      readonly later: PairActionTask;
    }
  /** Runs here: makes the change with both sides as parents, then starts an agent on top of it. */
  | {
      readonly kind: "resolve";
      readonly label: "Resolve together…";
      readonly integrate: Pick<JujutsuIntegrateInput, "a" | "b" | "later">;
      readonly later: PairActionTask;
    }
  /** Asks the later side's person to do it. */
  | {
      readonly kind: "ask";
      readonly label: string;
      readonly note: string;
      readonly recipient: string;
      readonly task: PairActionTask;
      readonly instruction: string;
    };

const sideOf = (pair: PeerForecastPair, side: "a" | "b"): PeerForecastSide => pair[side];
const otherSide = (side: "a" | "b") => (side === "a" ? "b" : "a");

/** A side's task, named by key when it has one, else its title, else its branch. */
export function pairTask(side: PeerForecastSide, tasks: ReadonlyArray<PairTask>): PairActionTask {
  const known = tasks.find((task) => task.id === side.task);
  const label = known?.key ?? known?.title ?? (side.title || side.branch);
  return { id: side.task ?? "", label };
}

/** What is wrong with a pair: it conflicts, or it merges clean and fails the check. */
export function pairProblem(pair: PeerForecastPair): "conflict" | "check" | null {
  // A pair that carries a check merges clean; only a failing one is a problem. A timeout or an
  // unreadable result is not known to be wrong, so no action is offered for it.
  if (pair.check !== undefined) return pair.check.state === "fails" ? "check" : null;
  return pair.files.length > 0 || pair.more > 0 ? "conflict" : null;
}

const filesLine = (pair: PeerForecastPair) => {
  const shown = pair.files.slice(0, 3).join(", ");
  return pair.more > 0 || pair.files.length > 3 ? `${shown} and more` : shown;
};

export function pairAction(input: PairActionInput): PairAction {
  const { pair } = input;
  const problem = pairProblem(pair);
  const later = pair.later;
  // A stacked side meets the conflict of the change it builds on: the pair that holds that
  // conflict has the action, and an integration of this pair would join the wrong changes.
  if (problem === null || later === undefined || pair.inheritedFrom !== undefined) {
    return { kind: "none" };
  }
  const laterSide = sideOf(pair, later);
  const earlierSide = sideOf(pair, otherSide(later));
  const laterTask = pairTask(laterSide, input.tasks);
  const earlierTask = pairTask(earlierSide, input.tasks);
  if (laterSide.task === undefined) return { kind: "none" };
  const session = input.sessions.find((candidate) => candidate.taskId === laterSide.task);
  if (session !== undefined) {
    if (problem === "check") {
      if (earlierSide.task === undefined) return { kind: "none" };
      return {
        kind: "build",
        label: `Build ${laterTask.label} on ${earlierTask.label}`,
        session: session.session,
        onto: earlierTask,
        later: laterTask,
      };
    }
    if (earlierSide.task === undefined) return { kind: "none" };
    return {
      kind: "resolve",
      label: "Resolve together…",
      integrate: {
        a: { task: pair.a.task ?? "", rev: pair.a.branch },
        b: { task: pair.b.task ?? "", rev: pair.b.branch },
        later,
      },
      later: laterTask,
    };
  }
  // Without a session here, the later side's own person is the one to ask; asking oneself, on
  // another computer of one's own, would go nowhere.
  if (input.me !== null && laterSide.email.toLowerCase() === input.me.toLowerCase()) {
    return { kind: "none" };
  }
  const person = input.nameOf(laterSide.email);
  const task = { id: laterSide.task, label: laterTask.label };
  if (problem === "check") {
    return {
      kind: "ask",
      label: `Ask ${person} to build ${laterTask.label} on ${earlierTask.label}…`,
      note: `“Build ${laterTask.label} on ${earlierTask.label}” is offered on ${person}'s computer, where ${laterTask.label} lives`,
      recipient: laterSide.email,
      task,
      instruction: `${laterTask.label} and ${earlierTask.label} merge clean but fail the check together. Please build ${laterTask.label} on ${earlierTask.label}, then run the check again.`,
    };
  }
  return {
    kind: "ask",
    label: `Ask ${person} to resolve…`,
    note: `“Resolve together…” is offered on ${person}'s computer`,
    recipient: laterSide.email,
    task,
    instruction: `${laterTask.label} and ${earlierTask.label} conflict${filesLine(pair) === "" ? "" : ` in ${filesLine(pair)}`}. Please resolve it on top of both, without rewriting either change.`,
  };
}

/** What a build says when it ran: where the work sits now, and that a conflict came with it. */
export function followOutcome(
  result: Pick<JujutsuFollowResult, "conflicts" | "onto">,
  action: { readonly later: PairActionTask; readonly onto: PairActionTask },
): string {
  const moved = `${action.later.label}'s work now builds on ${action.onto.label}. The pair is checked again, and the agent hears what moved.`;
  if (result.conflicts.length === 0) return moved;
  const files = result.conflicts.slice(0, 3).join(", ");
  return `${moved} The change now holds a conflict in ${files}${result.conflicts.length > 3 ? " and more" : ""}.`;
}

/**
 * The agent sessions on this computer that work on a task of the project in a jj checkout, from
 * herdr's agents and the task each was placed on (the work tree's own rule, without building the
 * tree for every card). Each is named by herdr's agent id, which `peer.jujutsu.follow` resolves.
 */
export function localSessions(input: {
  readonly status: Pick<PeerHubStatus, "agents" | "email" | "environmentId">;
  readonly workspace: string;
  readonly project: Pick<PeerProjectState, "project" | "work">;
}): ReadonlyArray<LocalSession> {
  const { status, workspace, project } = input;
  const { work } = project;
  const placed = (id: string | undefined) =>
    id !== undefined && work.tasks.some((task) => task.id === id) ? id : undefined;
  const sessions: LocalSession[] = [];
  for (const agent of status.agents.list) {
    if (agent.workspace !== workspace || agent.projectId !== project.project.id) continue;
    if (agent.vcs !== "jj" || agent.status === "done") continue;
    const record = work.threads.find(
      (thread) =>
        (thread.id === agent.id || thread.previousId === agent.id) &&
        thread.email === status.email &&
        thread.environment === status.environmentId,
    );
    const taskId =
      placed(runTaskOf(work.runs, agent.id)) ??
      placed(record === undefined ? undefined : runTaskOf(work.runs, record.id)) ??
      placed(record?.task) ??
      taskNamedIn(work.tasks, [agent.branch, agent.title])?.id;
    if (taskId === undefined) continue;
    sessions.push({ taskId, session: agent.id });
  }
  return sessions;
}
