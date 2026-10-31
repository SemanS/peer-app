/**
 * The team's work as the Work views show it, on web and on the phone alike.
 *
 * The work tree: Project → Area → Task → Threads. The hierarchy follows the
 * product and the work; the person is metadata on a thread, never a level.
 *
 * This computer's threads come live from its own thread list (and herdr);
 * other people's and other computers' come from the hub. A thread sits under
 * the task it was placed on, else the task its branch or title names by key
 * (`krk-812-split` → KRK-812), else under the project's unsorted work.
 *
 * The Work board: every thread of the team's projects as a card, in one column per state, the
 * way the tree places it. A project scope (one project, or all of them) is shared by the views so
 * they show the same work.
 */
import {
  localThreadStatus,
  personName,
  type AgentNeed,
  type NeedsYouItem,
  type WorkAgent,
  type WorkOpen,
} from "./needsYou.ts";
export {
  activeAgents,
  localThreadStatus,
  personName,
  taskLabel,
  type AgentNeed,
  type ActiveAgentNode,
  type WorkAgent,
  type WorkOpen,
} from "./needsYou.ts";
import type {
  PeerAcceptanceVia,
  PeerHubStatus,
  PeerLocalAgent,
  ProjectIconColor,
  PeerProjectState,
  PeerTask,
  PeerTaskKind,
  PeerWorkStatus,
  PeerWorkDelivery,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import { isExecutable, runTaskOf, taskKind } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "../state/models.ts";
import { HANDOFF_CLASS_LABEL, handoffNextSteps, statusHandoffFacts } from "./handoff.ts";
import { projectVcs, type PeerVcsKind } from "./vcsWords.ts";
import {
  projectOwnership,
  reviewRoute,
  taskOwnerView,
  type ProjectOwnership,
  type ReviewRoute,
  type TaskOwnerView,
} from "./ownershipRules.ts";

/** A colleague's thread nobody has reported for this long shows as no longer live. */
export const STALE_AFTER_MS = 3 * 60 * 1000;

export interface WorkThreadNode {
  readonly delivery?: PeerWorkDelivery;
  readonly localEnvironment?: boolean;
  readonly key: string;
  readonly title: string;
  readonly person: string;
  /** Their address, in lower case, so views can count chats by person without their titles. */
  readonly email?: string | undefined;
  readonly mine: boolean;
  readonly status: PeerWorkStatus;
  readonly harness: string | undefined;
  readonly branch: string | undefined;
  /** Its checkout's version control; absent is Git (an older Peer or Hub sends none). */
  readonly vcs?: PeerVcsKind | undefined;
  readonly source: "peer" | "herdr";
  /** A colleague's thread whose computer stopped reporting it. */
  readonly stale: boolean;
  readonly open: WorkOpen | undefined;
  /** This computer's threads can be placed under a task. */
  readonly placeable: boolean;
  /** Why a colleague's thread concerns you, e.g. its agent overlaps with yours. */
  readonly concerns: string | undefined;
  /** Its owner lets the team watch it live: yours when you shared it, a colleague's to observe. */
  readonly observable: boolean;
  /**
   * The agent that runs it: this computer's provider instance and model for a
   * Peer thread here, else the harness name (claude, codex, …) it reported.
   */
  readonly agent: WorkAgent | undefined;
  /** When it was last active, for threads on this computer. */
  readonly activeAt: string | undefined;
  /** Its agent keeps the shared context of the work it is on. */
  readonly keepsContext: boolean;
}

/** A handoff's open steps by class, as the status tells them. */
export interface HandoffNextCounts {
  readonly agentActions: number;
  readonly coordination: number;
  readonly humanDecisions: number;
  /** When the handoff was composed: how long it has been with the agent. */
  readonly at: string;
}

export interface WorkTaskNode {
  readonly id: string;
  readonly key: string | undefined;
  readonly title: string;
  readonly done: boolean;
  /** The Hub has it in review: a handoff waits for a person. */
  readonly inReview?: boolean;
  /**
   * In review with a current acceptance (not one given before it was reopened): who gave it, a
   * person or the project's review policy. It waits on nobody but its own landing.
   */
  readonly accepted?: PeerAcceptanceVia | undefined;
  /** In review after an agent's handoff: how many open steps of each class wait, and since when. */
  readonly handoffNext?: HandoffNextCounts | undefined;
  /** What the task's threads add up to: blocked beats working beats the rest. */
  readonly status: PeerWorkStatus;
  readonly threads: ReadonlyArray<WorkThreadNode>;
  /** Its creator, the project's leads and the workspace's admins may remove it. */
  readonly removable: boolean;
  /** Its shared context, once an agent on it started one. */
  readonly context: WorkContextNode | undefined;
  /**
   * The task it sits under. The work tree fills this and the tree's fields below; a node without
   * them is a root task that runs as one, as every task of an older Hub is.
   */
  readonly parent?: string | undefined;
  /** 0 for a root. */
  readonly depth?: number;
  readonly kind?: PeerTaskKind;
  /** May be given to an agent and run as one. */
  readonly executable?: boolean;
  /** Nobody decided yet whether it runs as one or by its parts: ask before starting it. */
  readonly unsettled?: boolean;
  /** Over its executable descendants, when it has any. */
  readonly progress?: { readonly done: number; readonly total: number } | undefined;
  /** How many items sit directly under it. */
  readonly childCount?: number;
  /** How many of its runs are in each state; absent from a Hub that predates runs. */
  readonly runs?:
    | { readonly running: number; readonly detached: number; readonly ended: number }
    | undefined;
}

/**
 * A task's shared context (or a project's, for work on no task): kept by one
 * agent session at a time, read by the other agents on it and by people.
 */
export interface WorkContextNode {
  readonly workspace: string;
  readonly project: string;
  /** `task:<id>`, or `project`. */
  readonly scope: string;
  readonly version: number;
  /** Where the work stands, in a line, as its keeper put it. */
  readonly gist: string | undefined;
  /** About how many tokens its text takes. */
  readonly tokens: number;
  /** The agent keeping it, while that agent reports. */
  readonly keeper:
    | {
        readonly person: string;
        readonly mine: boolean;
        readonly session: string;
        /** What its session is called: the thread's title or the agent's first prompt. */
        readonly label: string | undefined;
        readonly since: string;
      }
    | undefined;
  readonly updatedAt: string;
  /** Who wrote the version there is: the keeper's person, or the person who brought an older one back. */
  readonly updatedBy: string | undefined;
  /** The older version a person brought back, when that is what the version there is. */
  readonly restoredFrom: number | undefined;
  /**
   * What the work's agents found that its keeper has not decided yet (incorporated or dismissed),
   * however old: a later version does not settle a finding it left out.
   */
  readonly reports: ReadonlyArray<{
    readonly id: string;
    readonly person: string;
    readonly text: string;
    readonly at: string;
  }>;
}

export interface WorkAreaNode {
  /** Null for tasks without an area. */
  readonly name: string | null;
  readonly tasks: ReadonlyArray<WorkTaskNode>;
}

export interface WorkProjectNode {
  readonly workspace: string;
  readonly workspaceName: string;
  readonly projectId: string;
  readonly name: string;
  readonly areas: ReadonlyArray<WorkAreaNode>;
  /** Threads on no task yet. */
  readonly unsorted: ReadonlyArray<WorkThreadNode>;
  /** The shared context of the project's work on no task. */
  readonly context: WorkContextNode | undefined;
  /** Knowledge candidates waiting for people to keep or dismiss. */
  readonly candidates: number;
  readonly tasks: ReadonlyArray<PeerTask>;
  /** The version control of the project's checkouts on this computer. */
  readonly vcs?: PeerVcsKind | undefined;
  /**
   * The project's owners, owner map and calls as the Hub last said, with who is looking. Absent
   * while the ownership plugin is off, the Hub does not serve it or no view was read yet: the
   * board then shows no owners and asks every member for a review, as before ownership.
   */
  readonly ownership?: ProjectOwnership | undefined;
}

/**
 * The task a branch or title names by key, when exactly one does. Keys match
 * as whole tokens in any case: `krk-812-split` names KRK-812, KRK-8120 does not.
 */
export function taskNamedIn(
  tasks: ReadonlyArray<PeerTask>,
  texts: ReadonlyArray<string | null | undefined>,
): PeerTask | undefined {
  const haystacks = texts.filter((t): t is string => typeof t === "string" && t !== "");
  const named = tasks.filter((task) => {
    if (task.key === undefined) return false;
    const pattern = new RegExp(
      `(^|[^a-z0-9])${task.key.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`,
    );
    return haystacks.some((text) => pattern.test(text.toLowerCase()));
  });
  return named.length === 1 ? named[0] : undefined;
}

const STATUS_ORDER: Readonly<Record<PeerWorkStatus, number>> = {
  blocked: 0,
  working: 1,
  idle: 2,
  unknown: 3,
  done: 4,
};

/** Your own threads first, then what needs attention. */
export function byActivity(a: WorkThreadNode, b: WorkThreadNode): number {
  return (
    Number(b.mine) - Number(a.mine) ||
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    a.title.localeCompare(b.title)
  );
}

/** What a task's threads add up to, as `WorkTaskNode.status` says it. */
export function rollup(threads: ReadonlyArray<WorkThreadNode>, done: boolean): PeerWorkStatus {
  if (threads.some((t) => !t.stale && t.status === "blocked")) return "blocked";
  if (threads.some((t) => !t.stale && t.status === "working")) return "working";
  if (
    done ||
    (threads.length > 0 && threads.every((t) => t.delivery === "merged" || t.delivery === "closed"))
  )
    return "done";
  return "idle";
}

export type TaskStateKind =
  | "done"
  | "review"
  | "accepted"
  | "approval"
  | "input"
  | "agent_action"
  | "coordination"
  | "working"
  | "waiting"
  | "paused"
  | "new";

/** A task's state as every Work view says it, in words. */
export interface TaskState {
  readonly kind: TaskStateKind;
  /** "Ready for review", "Needs your answer", "Blocked on Ana"… */
  readonly label: string;
  /** Whom a colleague's waiting chat waits on, for `waiting`. */
  readonly waitingOn: string | undefined;
  /** How long it has been with the agent, for `agent_action`. */
  readonly since?: string | undefined;
}

const TASK_STATE_LABEL: Readonly<Record<Exclude<TaskStateKind, "waiting">, string>> = {
  done: "Done",
  review: "Ready for review",
  accepted: "Accepted",
  approval: "Needs your approval",
  input: "Needs your answer",
  agent_action: "With the agent",
  coordination: HANDOFF_CLASS_LABEL.coordination,
  working: "In progress",
  paused: "Paused",
  new: "Not started",
};

/** The tasks whose state waits on the person: a review, an approval or an answer. */
export const TASK_STATES_NEEDING_YOU: ReadonlySet<TaskStateKind> = new Set([
  "review",
  "approval",
  "input",
]);

/** A run or a chat of the task is still at work, so its agent can act on what it owes. */
export function taskRunLive(task: Pick<WorkTaskNode, "runs" | "threads">): boolean {
  return (
    (task.runs?.running ?? 0) > 0 ||
    task.threads.some((thread) => !thread.stale && thread.status === "working")
  );
}

/**
 * Who moves next on a task in review, as the class of the handoff's open steps; undefined when none
 * is open or the task has an acceptance. `live` says its run can still act.
 */
export function handoffMove(
  task: Pick<WorkTaskNode, "inReview" | "accepted" | "handoffNext" | "runs" | "threads">,
):
  | {
      readonly move: "human_decision" | "coordination" | "agent_action";
      readonly live: boolean;
      readonly label: string;
    }
  | undefined {
  const next = task.handoffNext;
  if (task.inReview !== true || task.accepted !== undefined || next === undefined) return undefined;
  const live = taskRunLive(task);
  if (next.humanDecisions > 0)
    return { move: "human_decision", live, label: HANDOFF_CLASS_LABEL.human_decision };
  if (next.coordination > 0)
    return { move: "coordination", live, label: HANDOFF_CLASS_LABEL.coordination };
  if (next.agentActions === 0) return undefined;
  return {
    move: "agent_action",
    live,
    label: live
      ? TASK_STATE_LABEL.agent_action
      : `The agent stopped · ${next.agentActions} ${next.agentActions === 1 ? "step" : "steps"} open`,
  };
}

/**
 * A task's state, the first rule that matches: the Hub's done (or every pull request merged or
 * closed) and review come first, then what your own chats wait for, then any chat at work, a
 * colleague's chat waiting on them, chats that stopped without a handoff, and no chat at all. A
 * colleague's chat nobody reports any more neither works nor waits. `needs` (Needs you's items)
 * tells an approval from an answer; without it a waiting chat of yours reads as an answer.
 *
 * A review's open steps decide whom it waits for. A person named on it is asked at once, under
 * `input`. While the run can act, agent actions read `agent_action` ("With the agent") and
 * coordination `coordination`, and nobody is asked to accept yet. Once it ended the same task comes
 * back to its person as a `review`, whose words name what is open and whose page offers Continue.
 *
 * A review asks the person only when `route` says so (it asks everyone without one, as before
 * ownership): "Ready for your review". One that asks someone else is no state of the person's:
 * what their own chats wait for comes first, and otherwise the task waits on that person,
 * "Ready for Slavo's review", under In progress.
 *
 * A task in review with an acceptance (`accepted`, by a lead or by the project's review policy)
 * asks nobody: after what the person's own chats wait for, its state is `accepted`.
 */
export function taskState(
  task: WorkTaskNode,
  needs: ReadonlyMap<string, AgentNeed> = new Map(),
  route?: ReviewRoute,
): TaskState {
  const state = (kind: Exclude<TaskStateKind, "waiting">): TaskState => ({
    kind,
    label: TASK_STATE_LABEL[kind],
    waitingOn: undefined,
  });
  if (task.done || task.status === "done") return state("done");
  const accepted = task.inReview === true && task.accepted !== undefined;
  const askedElsewhere = task.inReview === true && !accepted && route !== undefined && !route.forMe;
  const open = handoffMove(task);
  const withAgent = open !== undefined && open.move !== "human_decision" && open.live;
  if (task.inReview === true && !accepted && !askedElsewhere && !withAgent) {
    if (open?.move === "human_decision")
      return { kind: "input", label: open.label, waitingOn: undefined };
    if (open !== undefined) return { kind: "review", label: open.label, waitingOn: undefined };
    return route === undefined || route.audience === "everyone"
      ? state("review")
      : { kind: "review", label: "Ready for your review", waitingOn: undefined };
  }
  const live = task.threads.filter((thread) => !thread.stale);
  const waitingMine = live.filter((thread) => thread.mine && thread.status === "blocked");
  if (
    waitingMine.some(
      (thread) => thread.open !== undefined && needs.get(openKey(thread.open)) === "approval",
    )
  )
    return state("approval");
  if (waitingMine.length > 0) return state("input");
  if (accepted) return state("accepted");
  if (withAgent) {
    return open.move === "coordination"
      ? state("coordination")
      : { ...state("agent_action"), since: task.handoffNext?.at };
  }
  if (askedElsewhere) return waitingForReview(route);
  if (live.some((thread) => thread.status === "working")) return state("working");
  const waiting = live.find((thread) => !thread.mine && thread.status === "blocked");
  if (waiting !== undefined)
    return { kind: "waiting", label: `Blocked on ${waiting.person}`, waitingOn: waiting.person };
  return state(task.threads.length > 0 ? "paused" : "new");
}

/** A review that asks someone else: the task waits on them, in words that name them. */
function waitingForReview(route: ReviewRoute): TaskState {
  const reviewer =
    route.audience === "leads" && route.names.length !== 1 ? "a lead" : route.names[0];
  return {
    kind: "waiting",
    label: `Ready for ${reviewer ?? "someone"}'s review`,
    waitingOn: reviewer,
  };
}

/** The handoff's open steps by class, for a task in review; nothing without an agent's handoff. */
function handoffNextOf(
  status: PeerHubStatus,
  workspace: string,
  state: PeerProjectState,
  task: string,
): { readonly handoffNext?: HandoffNextCounts } {
  const read = statusHandoffFacts(status, { workspace, project: state.project.id, task });
  if (read === undefined) return {};
  const next = handoffNextSteps(read.facts);
  return {
    handoffNext: {
      agentActions: next.agent_action.length,
      coordination: next.coordination.length,
      humanDecisions: next.human_decision.length,
      at: read.at,
    },
  };
}

/** A shared context as the tree shows it, with the findings on its work its keeper has not decided. */
function contextNode(
  status: PeerHubStatus,
  workspace: string,
  state: PeerProjectState,
  scope: string,
): WorkContextNode | undefined {
  const project = state.project.id;
  const context = status.coordination.contexts.find(
    (c) => c.workspace === workspace && c.project === project && c.scope === scope,
  );
  if (context === undefined) return undefined;
  const keeper = context.keeper;
  const keeping =
    keeper === undefined
      ? undefined
      : status.coordination.sessions.find((session) => session.id === keeper.session);
  return {
    workspace,
    project,
    scope,
    version: context.version,
    gist: context.gist,
    tokens: Math.round(context.bytes / 4),
    keeper:
      keeper === undefined || keeping === undefined
        ? undefined
        : {
            person: personName(state, keeper.email),
            mine: keeper.email === status.email,
            session: keeper.session,
            label: keeping.label,
            since: keeper.since,
          },
    updatedAt: context.updatedAt,
    updatedBy: context.updatedBy === undefined ? undefined : personName(state, context.updatedBy),
    restoredFrom: context.restoredFrom,
    reports: status.coordination.findings
      .filter(
        (finding) =>
          finding.workspace === workspace &&
          finding.project === project &&
          (finding.task === undefined ? "project" : `task:${finding.task}`) === scope &&
          finding.decision === undefined,
      )
      .map((finding) => ({
        id: finding.id,
        person: personName(state, finding.email),
        text: finding.text,
        at: finding.at,
      })),
  };
}

/**
 * A project's tasks as a tree. A task whose parent is not among them, or that sits in a cycle, is
 * a root, so every task is listed exactly once whatever the Hub sends.
 */
function taskTree(tasks: ReadonlyArray<PeerTask>) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const listed = new Map(tasks.map((task, index) => [task.id, index]));
  // Siblings by position, then by when they were created, then as the Hub listed them, which is
  // its own order of creation.
  const bySiblingOrder = (a: PeerTask, b: PeerTask) =>
    (a.position ?? 0) - (b.position ?? 0) ||
    a.createdAt.localeCompare(b.createdAt) ||
    listed.get(a.id)! - listed.get(b.id)!;
  const reachesItself = (task: PeerTask) => {
    const seen = new Set([task.id]);
    for (let at = task.parent; at !== undefined; at = byId.get(at)?.parent) {
      if (seen.has(at)) return true;
      seen.add(at);
    }
    return false;
  };
  const parentOf = new Map<string, string>();
  for (const task of tasks) {
    if (task.parent !== undefined && byId.has(task.parent) && !reachesItself(task)) {
      parentOf.set(task.id, task.parent);
    }
  }
  const children = new Map<string, Array<PeerTask>>();
  for (const task of tasks) {
    const parent = parentOf.get(task.id);
    if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), task]);
  }
  for (const siblings of children.values()) siblings.sort(bySiblingOrder);
  const roots = tasks.filter((task) => !parentOf.has(task.id)).sort(bySiblingOrder);
  const depthOf = new Map<string, number>();
  const order = (root: PeerTask): ReadonlyArray<PeerTask> => {
    const out: Array<PeerTask> = [];
    const visit = (task: PeerTask, depth: number) => {
      depthOf.set(task.id, depth);
      out.push(task);
      for (const child of children.get(task.id) ?? []) visit(child, depth + 1);
    };
    visit(root, 0);
    return out;
  };
  for (const root of roots) order(root);
  return { roots, children, parentOf, depthOf, order };
}

function projectTree(input: {
  readonly status: PeerHubStatus;
  readonly workspace: PeerWorkspaceState;
  readonly state: PeerProjectState;
  readonly localThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly agents: ReadonlyArray<PeerLocalAgent>;
  readonly now: number;
  readonly watch: boolean;
}): WorkProjectNode {
  const { status, workspace, state } = input;
  const { work } = state;
  const me = status.email;
  const myName = me === null ? "you" : personName(state, me);
  const t3ProjectIds = new Set(
    state.repositories.flatMap((repo) => (repo.projectId === undefined ? [] : [repo.projectId])),
  );
  const taskOf = (placed: string | undefined, texts: ReadonlyArray<string | null | undefined>) =>
    (placed !== undefined && work.tasks.some((t) => t.id === placed)
      ? placed
      : taskNamedIn(work.tasks, texts)?.id) ?? null;

  const shared = new Set(status.sharedThreads);
  const localRecord = (id: string) =>
    work.threads.find(
      (thread) =>
        thread.id === id && thread.email === me && thread.environment === status.environmentId,
    );
  const placed: Array<{ readonly task: string | null; readonly node: WorkThreadNode }> = [];
  for (const thread of input.localThreads) {
    if (
      thread.environmentId !== status.environmentId ||
      !t3ProjectIds.has(thread.projectId) ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null
    ) {
      continue;
    }
    const key = `peer:${thread.id}`;
    placed.push({
      task: taskOf(runTaskOf(work.runs, key), [thread.branch, thread.title]),
      node: {
        key,
        title: thread.title,
        person: myName,
        email: me?.toLowerCase(),
        mine: true,
        status: localThreadStatus(thread),
        delivery: localRecord(key)?.delivery ?? "open",
        localEnvironment: true,
        harness: undefined,
        branch: thread.branch ?? undefined,
        // This computer's checkout says it before the Hub has the thread's report.
        vcs:
          localRecord(key)?.vcs ??
          state.repositories.find((repo) => repo.projectId === thread.projectId)?.vcs,
        source: "peer",
        stale: localRecord(key)?.runtimePresent === false,
        open: { kind: "thread", environmentId: thread.environmentId, threadId: thread.id },
        placeable: true,
        concerns: undefined,
        observable: shared.has(key),
        agent: {
          instanceId: thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId,
          model: thread.modelSelection.model,
        },
        activeAt: thread.latestUserMessageAt ?? thread.updatedAt,
        keepsContext: false,
      },
    });
  }
  for (const agent of input.agents) {
    if (agent.workspace !== workspace.slug || agent.projectId !== state.project.id) continue;
    const record =
      localRecord(agent.id) ??
      work.threads.find(
        (thread) =>
          thread.previousId === agent.id &&
          thread.email === me &&
          thread.environment === status.environmentId &&
          (agent.branch === undefined || thread.branch === agent.branch),
      );
    const key = record?.id ?? agent.id;
    placed.push({
      task: taskOf(runTaskOf(work.runs, key) ?? runTaskOf(work.runs, agent.id), [
        agent.branch,
        agent.title,
      ]),
      node: {
        key,
        title: agent.title,
        person: myName,
        email: me?.toLowerCase(),
        mine: true,
        status: agent.status,
        delivery: record?.delivery ?? "open",
        localEnvironment: true,
        harness: agent.agent,
        branch: agent.branch,
        vcs: agent.vcs,
        source: "herdr",
        stale: false,
        open: { kind: "herdr", agentId: agent.id, paneId: agent.paneId },
        placeable: true,
        concerns: undefined,
        observable: shared.has(agent.id),
        agent: agent.agent === undefined ? undefined : { harness: agent.agent },
        activeAt: undefined,
        keepsContext: false,
      },
    });
  }
  // A colleague's agent in an open overlap with one of yours concerns you.
  const yours = new Set(
    status.coordination.sessions
      .filter((session) => session.email === me)
      .map((session) => session.id),
  );
  const overlapping = new Map<string, string>();
  for (const overlap of status.coordination.overlaps) {
    if (
      overlap.state !== "open" ||
      overlap.workspace !== workspace.slug ||
      overlap.project !== state.project.id
    ) {
      continue;
    }
    const [a, b] = overlap.sessions;
    if (a === undefined || b === undefined || yours.has(a) === yours.has(b)) continue;
    overlapping.set(yours.has(a) ? b : a, overlap.files.join(", "));
  }
  for (const thread of work.threads) {
    const localEnvironment = thread.email === me && thread.environment === status.environmentId;
    if (localEnvironment && placed.some((entry) => entry.node.key === thread.id)) continue;
    const seenAt = Date.parse(thread.seenAt);
    const stale =
      thread.runtimePresent === false ||
      !Number.isFinite(seenAt) ||
      input.now - seenAt >= STALE_AFTER_MS;
    const watchable = input.watch && !stale && thread.observable === true;
    // A herdr agent known by its session reports `herdr:<agent>:<session>`; coordination says `<agent>:<session>`.
    const session = /^herdr:([^:]+:.+)$/.exec(thread.id)?.[1];
    const files = session === undefined ? undefined : overlapping.get(session);
    placed.push({
      task: taskOf(
        localEnvironment ? (runTaskOf(work.runs, thread.id) ?? thread.task) : thread.task,
        [thread.branch, thread.title],
      ),
      node: {
        key: localEnvironment ? thread.id : `${thread.environment}:${thread.id}`,
        title: thread.title,
        person: personName(state, thread.email),
        email: thread.email.toLowerCase(),
        mine: thread.email === me,
        status: stale ? "unknown" : thread.status,
        delivery: thread.delivery ?? "open",
        localEnvironment,
        harness: thread.harness,
        branch: thread.branch,
        vcs: thread.vcs,
        source: thread.source,
        stale,
        open: watchable
          ? {
              kind: "observe",
              workspace: workspace.slug,
              environment: thread.environment,
              thread: thread.id,
            }
          : undefined,
        placeable: localEnvironment,
        concerns:
          files === undefined || thread.email === me
            ? undefined
            : `Its agent and yours both change ${files}`,
        observable: watchable,
        agent: thread.harness === undefined ? undefined : { harness: thread.harness },
        activeAt: undefined,
        keepsContext: false,
      },
    });
  }

  // A herdr agent's thread is known by its session (`herdr:claude:<id>`, after its computer for a
  // colleague's), the keeper by the session alone.
  const keeping = (context: WorkContextNode | undefined) => (node: WorkThreadNode) =>
    context?.keeper !== undefined &&
    /(?:^|:)herdr:(.+)$/.exec(node.key)?.[1] === context.keeper.session
      ? { ...node, keepsContext: true }
      : node;
  const tree = taskTree(work.tasks);
  // A task in review with a current acceptance waits on nobody (`WorkTaskNode.accepted`).
  const acceptedVia = new Map(
    (status.acceptance?.accepted ?? [])
      .filter(
        (row) =>
          row.workspace === workspace.slug &&
          row.project === state.project.id &&
          row.beforeReopening !== true,
      )
      .map((row) => [row.task, row.via ?? "person"] as const),
  );
  const taskNodes = new Map<string, WorkTaskNode>();
  for (const task of work.tasks) {
    const context = contextNode(status, workspace.slug, state, `task:${task.id}`);
    const threads = placed
      .filter((entry) => entry.task === task.id)
      .map((entry) => keeping(context)(entry.node))
      .sort(byActivity);
    taskNodes.set(task.id, {
      id: task.id,
      key: task.key,
      title: task.title,
      done: task.status === "done",
      inReview: task.status === "review",
      accepted: task.status === "review" ? acceptedVia.get(task.id) : undefined,
      status: rollup(threads, task.status === "done"),
      threads,
      removable:
        task.createdBy === me || state.project.role === "lead" || workspace.role !== "member",
      context,
      parent: tree.parentOf.get(task.id),
      depth: tree.depthOf.get(task.id) ?? 0,
      kind: taskKind(task),
      executable: isExecutable(task),
      unsettled: task.unsettled === true,
      progress: task.progress,
      childCount: tree.children.get(task.id)?.length ?? 0,
      runs: task.runs,
      ...(task.status === "review" ? handoffNextOf(status, workspace.slug, state, task.id) : {}),
    });
  }
  const projectContext = contextNode(status, workspace.slug, state, "project");
  // Areas the project declares come first, in its order; then those tasks name; then no area. An
  // item is listed with its root, whatever its own area.
  const areaNames = [...work.areas];
  for (const root of tree.roots) {
    if (root.area !== undefined && !areaNames.includes(root.area)) areaNames.push(root.area);
  }
  const subtreeNodes = (root: PeerTask) =>
    tree.order(root).flatMap((task) => taskNodes.get(task.id) ?? []);
  const areas: WorkAreaNode[] = areaNames.map((name) => ({
    name,
    tasks: tree.roots.filter((t) => t.area === name).flatMap(subtreeNodes),
  }));
  const loose = tree.roots.filter((t) => t.area === undefined);
  if (loose.length > 0) {
    areas.push({ name: null, tasks: loose.flatMap(subtreeNodes) });
  }
  return {
    workspace: workspace.slug,
    workspaceName: workspace.name,
    projectId: state.project.id,
    name: state.project.name,
    areas,
    unsorted: placed
      .filter((entry) => entry.task === null)
      .map((entry) => keeping(projectContext)(entry.node))
      .sort(byActivity),
    context: projectContext,
    candidates:
      status.coordination.candidates.find(
        (waiting) => waiting.workspace === workspace.slug && waiting.project === state.project.id,
      )?.proposed ?? 0,
    tasks: work.tasks,
    vcs: projectVcs(state.repositories),
    ownership: projectOwnership(status, workspace, state.project),
  };
}

/** What one agent did with the team's work and knowledge, as the work's page lists it. */
export interface WorkAdviceRow {
  readonly key: string;
  /** Whose agent it is, and what it is called. */
  readonly person: string;
  readonly mine: boolean;
  readonly agent: string;
  readonly about: "work" | "knowledge";
  /** A work's scope to open its page, or `kx:<id>` for an entry of the project's knowledge. */
  readonly scope: string;
  readonly name: string;
  /** The agent read it or asked its agents, a model found it for the agent, or an entry governs files it changes. */
  readonly how: "read" | "asked" | "found" | "governs";
  readonly why: string;
  /** For knowledge: decision, convention, learning or incident, and where its file is. */
  readonly entryKind: string | undefined;
  readonly path: string | undefined;
  readonly at: string;
}

/**
 * What the agents on one work (a task, or the project's work on no task) did with the team's work
 * and the project's knowledge, newest first: people see what their agents rely on.
 */
export function adviceOnWork(input: {
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: string;
  readonly scope: string;
}): ReadonlyArray<WorkAdviceRow> {
  const { status, workspace, project, scope } = input;
  const state = status.workspaces
    .find((w) => w.slug === workspace)
    ?.projects.find((p) => p.project.id === project);
  const sessions = new Map(status.coordination.sessions.map((session) => [session.id, session]));
  return (status.coordination.advice ?? [])
    .flatMap((advice) => {
      const session = sessions.get(advice.session);
      if (advice.workspace !== workspace || advice.project !== project || session === undefined) {
        return [];
      }
      const on = session.task === undefined ? "project" : `task:${session.task}`;
      if (on !== scope) return [];
      return [
        {
          key: `${advice.session}:${advice.scope}:${advice.at}`,
          person: state === undefined ? session.email : personName(state, session.email),
          mine: session.email === status.email,
          agent: session.label,
          about: advice.about,
          scope: advice.scope,
          name: advice.name,
          how: advice.how,
          why: advice.why,
          entryKind: advice.entryKind,
          path: advice.path,
          at: advice.at,
        } satisfies WorkAdviceRow,
      ];
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 12);
}

/** What one row says, in a line: whose agent, and what it did. */
export function adviceLabel(row: WorkAdviceRow): string {
  const who = row.mine ? "Your agent" : `${row.person}’s agent`;
  const entry =
    row.entryKind === undefined ? "an entry of the project" : `a ${row.entryKind} of the project`;
  switch (row.how) {
    case "read":
      return `${who} read ${row.about === "knowledge" ? entry : "this work’s context"}`;
    case "asked":
      return `${who} asked this work’s agents`;
    case "found":
      return `${who} was pointed to ${row.about === "knowledge" ? entry : "this work"} by a model it asked`;
    case "governs":
      return `${who} was reminded of ${entry} that governs files it changes`;
  }
}

/**
 * Every workspace project this person is on, as a tree. A colleague's shared thread can be watched
 * only while `watch` is set (Observe is active here; the default); without it the thread shows as
 * any other of theirs, read-only.
 */
export function buildWorkTree(input: {
  readonly status: PeerHubStatus;
  readonly localThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly now: number;
  readonly watch?: boolean;
}): ReadonlyArray<WorkProjectNode> {
  return input.status.workspaces.flatMap((workspace) =>
    workspace.projects.map((state) =>
      projectTree({
        status: input.status,
        workspace,
        state,
        localThreads: input.localThreads,
        agents: input.status.agents.list,
        now: input.now,
        watch: input.watch ?? true,
      }),
    ),
  );
}

/** The items directly under a task, in order. */
export function childrenOf(area: WorkAreaNode, id: string): ReadonlyArray<WorkTaskNode> {
  return area.tasks.filter((task) => task.parent === id);
}

/** Everything under a task, at any depth, in tree order; the task itself not among them. */
export function subtreeOf(area: WorkAreaNode, id: string): ReadonlyArray<WorkTaskNode> {
  const at = area.tasks.findIndex((task) => task.id === id);
  if (at === -1) return [];
  const depth = area.tasks[at]!.depth ?? 0;
  const end = area.tasks.findIndex((task, index) => index > at && (task.depth ?? 0) <= depth);
  return area.tasks.slice(at + 1, end === -1 ? undefined : end);
}

const isOpenWork = (task: WorkTaskNode) =>
  task.executable !== false && !task.done && task.inReview !== true;

/**
 * The open executable items a scope covers, in tree order: everything open under task `id`, or,
 * without one, every open executable task of the area or project.
 */
export function scopeItems(
  scope: WorkAreaNode | WorkProjectNode,
  id?: string,
): ReadonlyArray<WorkTaskNode> {
  const areas = "areas" in scope ? scope.areas : [scope];
  if (id === undefined) return areas.flatMap((area) => area.tasks).filter(isOpenWork);
  const area = areas.find((candidate) => candidate.tasks.some((task) => task.id === id));
  return area === undefined ? [] : subtreeOf(area, id).filter(isOpenWork);
}

export interface WorkScopeItem {
  readonly id: string;
  readonly title: string;
}

/** What an agent is started on: one task, a group's open items, or an area's open tasks. */
export type WorkScope =
  | { readonly kind: "task"; readonly id: string; readonly title: string }
  | {
      readonly kind: "group";
      readonly id: string;
      readonly title: string;
      readonly project: string;
      readonly items: ReadonlyArray<WorkScopeItem>;
    }
  | {
      readonly kind: "area";
      /** Null for the tasks without an area. */
      readonly name: string | null;
      readonly project: string;
      readonly items: ReadonlyArray<WorkScopeItem>;
    };

/** A task of the tree as a scope: itself when it runs as one, else its open items. */
export function scopeOfTask(project: WorkProjectNode, task: WorkTaskNode): WorkScope {
  return task.executable === false
    ? {
        kind: "group",
        id: task.id,
        title: task.title,
        project: project.name,
        items: scopeItems(project, task.id),
      }
    : { kind: "task", id: task.id, title: task.title };
}

export function scopeOfArea(project: WorkProjectNode, area: WorkAreaNode): WorkScope {
  return { kind: "area", name: area.name, project: project.name, items: scopeItems(area) };
}

/** A prompt lists this many items, then says how many more there are. */
const SCOPE_ITEMS_LISTED = 30;

/**
 * The first prompt of an agent started on a scope, the same from every launcher. An unsettled
 * item is never given here: whoever starts it settles it first.
 */
export function scopePrompt(scope: WorkScope | ReadonlyArray<WorkScope>): string {
  if (!isScopeList(scope)) return oneScopePrompt(scope);
  if (scope.length === 1) return oneScopePrompt(scope[0]!);
  const project = scope.find((one) => one.kind !== "task")?.project;
  const head =
    project === undefined
      ? `Work on these ${scope.length} Peer scopes, in this order:`
      : `Work on these ${scope.length} Peer scopes in ${project}, in this order:`;
  const parts = scope.map((one, index) => {
    const lines = oneScopePrompt(one).split("\n");
    // Each scope's own "Mark each …" line gives way to the one closing line of the set.
    const kept = lines.at(-1)?.startsWith("Mark each ") === true ? lines.slice(0, -1) : lines;
    return `${index + 1}. ${kept.join("\n")}`;
  });
  return [
    head,
    ...parts,
    "Mark each item done with peer task set <id> --status done as you finish it; peer done finishes the scope you are on.",
  ].join("\n\n");
}

function isScopeList(
  scope: WorkScope | ReadonlyArray<WorkScope>,
): scope is ReadonlyArray<WorkScope> {
  return Array.isArray(scope);
}

function oneScopePrompt(scope: WorkScope): string {
  if (scope.kind === "task") return `Work on the Peer task "${scope.title}" (${scope.id}).`;
  const listed = scope.items
    .slice(0, SCOPE_ITEMS_LISTED)
    .map((item) => `- ${item.id} ${item.title}`);
  const more = scope.items.length - listed.length;
  const list = [...listed, ...(more > 0 ? [`and ${more} more`] : [])];
  if (scope.kind === "group") {
    return [
      `Work on the Peer group "${scope.title}" (${scope.id}) in ${scope.project}: its open items, in order:`,
      ...list,
      "Mark each item done with peer task set <id> --status done as you finish it; peer done on the group finishes the group itself.",
    ].join("\n");
  }
  return [
    scope.name === null
      ? `Work on the tasks of ${scope.project} without an area: its open tasks, in order:`
      : `Work on the area "${scope.name}" of ${scope.project}: its open tasks, in order:`,
    ...list,
    "Mark each task done with peer task set <id> --status done as you finish it.",
  ].join("\n");
}

/** A context's size the way people read it: `~2.1k tokens`. */
export function contextSize(tokens: number): string {
  return tokens >= 1000 ? `~${(tokens / 1000).toFixed(1)}k tokens` : `~${tokens} tokens`;
}

/** What the open route shows, in the terms of `WorkOpen`, to highlight it in the tree. */
export function openKey(open: WorkOpen): string {
  switch (open.kind) {
    case "thread":
      return `${open.environmentId}:${open.threadId}`;
    case "herdr":
      return `agent:${open.agentId}`;
    case "observe":
      return `observe:${open.workspace}:${open.environment}:${open.thread}`;
    case "context":
      return `context:${open.workspace}:${open.project}:${open.scope}`;
  }
  const unreachable: never = open;
  return unreachable;
}

export const ALL_PROJECTS = "all";

/** The scope key of one project: its workspace and id. */
export function projectScopeKey(project: Pick<WorkProjectNode, "workspace" | "projectId">): string {
  return `${project.workspace}/${project.projectId}`;
}

/**
 * Project colors only say which project something is in. They avoid the hues the signals use.
 */
const PROJECT_COLORS: ReadonlyArray<ProjectIconColor> = [
  "indigo",
  "pink",
  "sky",
  "lime",
  "fuchsia",
  "cyan",
  "rose",
  "yellow",
];

/**
 * A project's color, from its scope key, so the project keeps it on every computer and client
 * (web's `projectColor` in `signals.tsx` is the same rule).
 */
export function projectColor(key: string): ProjectIconColor {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length]!;
}

/** The scope to show: the chosen project while the tree still has it, else all projects. */
export function resolveScope(scope: string, tree: ReadonlyArray<WorkProjectNode>): string {
  return scope !== ALL_PROJECTS && tree.some((project) => projectScopeKey(project) === scope)
    ? scope
    : ALL_PROJECTS;
}

export function inScope(scope: string, project: WorkProjectNode): boolean {
  return scope === ALL_PROJECTS || projectScopeKey(project) === scope;
}

export type BoardColumn = "needs" | "working" | "review" | "idle";

export const BOARD_COLUMNS: ReadonlyArray<{ readonly id: BoardColumn; readonly title: string }> = [
  { id: "needs", title: "Needs you" },
  { id: "working", title: "Working" },
  { id: "review", title: "Needs review" },
  { id: "idle", title: "Idle" },
];

/**
 * Where a thread sits on the board: waiting on you, working, finished or in review, or idle. A
 * thread waiting for an approval or an answer waits on its owner: yours needs you, a colleague's
 * is still their work in progress. Merged and closed work leaves the board; a colleague's thread
 * nobody reports any more is idle, marked away.
 */
export function boardColumn(thread: WorkThreadNode): BoardColumn | null {
  if (thread.delivery === "merged" || thread.delivery === "closed") return null;
  if (thread.stale) return "idle";
  if (thread.status === "blocked") return thread.mine ? "needs" : "working";
  if (thread.status === "working") return "working";
  if (thread.delivery === "review" || thread.status === "done") return "review";
  return "idle";
}

type NeedOf<Kind extends NeedsYouItem["kind"]> = Extract<NeedsYouItem, { readonly kind: Kind }>;

/** Where a card of the board sits: in which of its board's columns, in which project and task. */
interface CardPlace<Column extends string | null> {
  readonly key: string;
  readonly column: Column;
  readonly project: WorkProjectNode;
  /** The task it is on; undefined for work on no task. */
  readonly task: WorkTaskNode | undefined;
}

/**
 * A card for something besides work that waits on the person — a teammate's request, an overlap
 * that needs their decision, a context their agent read before it changed, or an agent's call to
 * change a path they own. Both boards, by thread and by task, keep it under Needs you.
 */
export type NeedCard =
  | (CardPlace<"needs"> & { readonly kind: "request"; readonly item: NeedOf<"request"> })
  | (CardPlace<"needs"> & { readonly kind: "overlap"; readonly item: NeedOf<"overlap"> })
  | (CardPlace<"needs"> & { readonly kind: "stale"; readonly item: NeedOf<"stale"> })
  | (CardPlace<"needs"> & { readonly kind: "owner-call"; readonly item: NeedOf<"owner-call"> })
  | (CardPlace<"needs"> & { readonly kind: "answer"; readonly item: NeedOf<"answer"> });

/**
 * A chat (or herdr agent) of yours on no task that waits for your approval or your answer. On the
 * board by task it belongs to no task's card, so it is a card of its own under Needs you.
 */
export type ChatNeedCard = CardPlace<"needs"> & {
  readonly kind: "chat";
  readonly item: NeedOf<"thread" | "agent">;
};

/**
 * One card of the board by thread (the phone's, and the sidebar's until it follows the board by
 * task): a thread of the tree, or something else that waits on the person.
 */
export type BoardCard =
  | (CardPlace<BoardColumn> & {
      readonly kind: "thread";
      readonly thread: WorkThreadNode;
      /** What the person's own thread waits for, as Needs you says it. */
      readonly need: AgentNeed | undefined;
      /** Whom a colleague's waiting thread waits on. */
      readonly waitingOn: string | undefined;
    })
  | NeedCard;

/** What a card is called, whatever it shows. */
export function boardCardTitle(card: BoardCard): string {
  return card.kind === "thread" ? card.thread.title : card.item.title;
}

/** A card that waits on the person is theirs, whoever sent it. */
function cardIsMine(card: BoardCard): boolean {
  return card.kind === "thread" ? card.thread.mine : true;
}

function projectCards(
  project: WorkProjectNode,
  needOf: ReadonlyMap<string, AgentNeed> = new Map(),
): ReadonlyArray<BoardCard> {
  const card = (thread: WorkThreadNode, task: WorkTaskNode | undefined): BoardCard[] => {
    const column = boardColumn(thread);
    return column === null
      ? []
      : [
          {
            kind: "thread",
            key: `${projectScopeKey(project)}:${thread.key}`,
            column,
            thread,
            project,
            task,
            need: thread.open === undefined ? undefined : needOf.get(openKey(thread.open)),
            waitingOn:
              thread.status === "blocked" && !thread.mine && !thread.stale
                ? thread.person
                : undefined,
          },
        ];
  };
  return [
    ...project.areas.flatMap((area) =>
      area.tasks.flatMap((task) => task.threads.flatMap((thread) => card(thread, task))),
    ),
    ...project.unsorted.flatMap((thread) => card(thread, undefined)),
  ];
}

/** The project a request, an overlap, stale inputs or an owner's call concern, as a scope key. */
function itemProject(
  item: NeedOf<"request" | "overlap" | "stale" | "owner-call" | "answer">,
): string | undefined {
  switch (item.kind) {
    case "owner-call":
    case "answer":
      return `${item.workspace}/${item.project}`;
    case "request":
      return `${item.workspace}/${item.request.project}`;
    case "overlap":
      return `${item.overlap.workspace}/${item.overlap.project}`;
    case "stale":
      return item.session === undefined
        ? undefined
        : `${item.session.workspace}/${item.session.project}`;
  }
}

function taskById(project: WorkProjectNode, id: string | null | undefined) {
  return id == null
    ? undefined
    : project.areas.flatMap((area) => area.tasks).find((task) => task.id === id);
}

/**
 * Cards for what waits on the person besides their threads. A thread or an agent that needs them
 * is already a thread card (or a task's), so it adds none.
 */
function needCards(
  tree: ReadonlyArray<WorkProjectNode>,
  needs: ReadonlyArray<NeedsYouItem>,
): ReadonlyArray<NeedCard> {
  const projects = new Map(tree.map((project) => [projectScopeKey(project), project]));
  return needs.flatMap((item): NeedCard[] => {
    if (item.kind === "thread" || item.kind === "agent") return [];
    const project = projects.get(itemProject(item) ?? "");
    if (project === undefined) return [];
    const key = `${projectScopeKey(project)}:${item.key}`;
    switch (item.kind) {
      case "request":
        return [
          {
            kind: "request",
            key,
            column: "needs",
            project,
            task: taskById(project, item.request.task),
            item,
          },
        ];
      case "overlap": {
        // The overlap's own task, when the person's agent is on one.
        const asked = item.overlap.files.find((path) => path.startsWith("task:"));
        return [
          {
            kind: "overlap",
            key,
            column: "needs",
            project,
            task: taskById(project, asked?.slice("task:".length)),
            item,
          },
        ];
      }
      case "stale":
        return [
          {
            kind: "stale",
            key,
            column: "needs",
            project,
            task: taskById(project, item.session?.task),
            item,
          },
        ];
      case "owner-call":
        return [
          {
            kind: "owner-call",
            key,
            column: "needs",
            project,
            task: taskById(project, item.call.task),
            item,
          },
        ];
      case "answer":
        return [
          {
            kind: "answer",
            key,
            column: "needs",
            project,
            task: taskById(project, item.task),
            item,
          },
        ];
    }
  });
}

/** What the board's search finds a request, an overlap or stale inputs by. */
function needTexts(card: NeedCard): ReadonlyArray<string | undefined> {
  switch (card.kind) {
    case "request":
      return [card.item.title, card.item.request.sender, card.item.request.prompt];
    case "overlap":
      return [card.item.title, ...card.item.participants];
    case "stale":
      return [card.item.title];
    case "answer":
      return [card.item.title, card.item.taskName];
    case "owner-call":
      return [
        card.item.title,
        card.item.asker,
        card.item.owner,
        card.item.call.reason,
        ...card.item.call.paths,
      ];
  }
}

/** Whether any of the texts holds the (lower-cased, trimmed) query; an empty query holds in all. */
function textsMatch(texts: ReadonlyArray<string | undefined>, query: string): boolean {
  return (
    query === "" || texts.some((text) => text !== undefined && text.toLowerCase().includes(query))
  );
}

function matches(card: BoardCard, query: string): boolean {
  const texts =
    card.kind === "thread"
      ? [card.thread.title, card.thread.branch, card.thread.person]
      : needTexts(card);
  return textsMatch([...texts, card.task?.key, card.task?.title, card.project.name], query);
}

/** What waits first: an approval, an answer, a request, an overlap, stale inputs; then the rest. */
function cardRank(card: BoardCard): number {
  if (card.kind !== "thread") return card.item.rank;
  return card.need === "approval" ? 0 : card.need === "input" ? 1 : 6;
}

function cardActiveAt(card: BoardCard): string {
  return (card.kind === "thread" ? card.thread.activeAt : card.item.since) ?? "0";
}

/** Your own work first, then what waits first, then what was active last, then by title. */
function byRelevance(a: BoardCard, b: BoardCard): number {
  return (
    Number(cardIsMine(b)) - Number(cardIsMine(a)) ||
    cardRank(a) - cardRank(b) ||
    Date.parse(cardActiveAt(b)) - Date.parse(cardActiveAt(a)) ||
    boardCardTitle(a).localeCompare(boardCardTitle(b))
  );
}

/** Needs you's own threads and agents, by what each opens: what `taskState` takes. */
export function needsByOpen(needs: ReadonlyArray<NeedsYouItem>): ReadonlyMap<string, AgentNeed> {
  const map = new Map<string, AgentNeed>();
  for (const item of needs) {
    if (item.kind === "thread" || item.kind === "agent") map.set(openKey(item.open), item.need);
  }
  return map;
}

/**
 * The board's cards in scope, only yours when `mine`, matching the search. `needs` (Needs you's
 * items) adds the cards for requests, overlaps and stale inputs, and says what each of your
 * waiting threads waits for.
 */
export function boardCards(
  tree: ReadonlyArray<WorkProjectNode>,
  input: {
    readonly scope: string;
    readonly mine: boolean;
    readonly query: string;
    readonly needs?: ReadonlyArray<NeedsYouItem>;
  },
): ReadonlyArray<BoardCard> {
  const query = input.query.trim().toLowerCase();
  const needs = input.needs ?? [];
  const needOf = needsByOpen(needs);
  const scoped = tree.filter((project) => inScope(input.scope, project));
  return [
    ...scoped.flatMap((project) => projectCards(project, needOf)),
    ...needCards(scoped, needs),
  ]
    .filter((card) => (!input.mine || cardIsMine(card)) && matches(card, query))
    .sort(byRelevance);
}

export type ColumnCounts = Readonly<Record<BoardColumn, number>>;

/**
 * How many of a project's cards (all of them, or only yours) sit in each column; with `needs`, its
 * requests, overlaps and stale inputs count under Needs you too.
 */
export function projectCounts(
  project: WorkProjectNode,
  mine = false,
  needs: ReadonlyArray<NeedsYouItem> = [],
): ColumnCounts {
  const counts = { needs: 0, working: 0, review: 0, idle: 0 };
  for (const card of [...projectCards(project), ...needCards([project], needs)]) {
    if (!mine || cardIsMine(card)) counts[card.column] += 1;
  }
  return counts;
}

/**
 * The Work board and list by task, as the web shows them: one card per task, in the column its
 * `taskState` puts it in. What waits on the person besides tasks (a teammate's request, an overlap
 * to decide) stays under Needs you as its own card; inputs that changed are the agents' to re-read,
 * nothing a person decides, so they make no card here. The cards by thread above
 * stay for the phone and the sidebar until they follow; `needs` is Needs you's id in both.
 */
export type TaskColumn = "needs" | "working" | "paused" | "new";

export const TASK_COLUMNS: ReadonlyArray<{ readonly id: TaskColumn; readonly title: string }> = [
  { id: "needs", title: "Needs your attention" },
  { id: "working", title: "In progress" },
  { id: "paused", title: "Paused" },
  { id: "new", title: "Not started" },
];

/**
 * Where a task's state puts it: what waits on the person under Needs you (a review, an approval
 * or an answer, whatever its chats do), work in progress, a colleague's chat waiting on its
 * owner or an accepted task waiting to land under In progress, then Paused and Not started. A done task leaves the board (null): the
 * board counts them in a line, the list has them under Done.
 */
export function taskColumn(state: TaskState): TaskColumn | null {
  switch (state.kind) {
    case "done":
      return null;
    case "review":
    case "approval":
    case "input":
      return "needs";
    case "working":
    case "waiting":
    case "accepted":
    case "agent_action":
    case "coordination":
      return "working";
    case "paused":
      return "paused";
    case "new":
      return "new";
  }
}

/** Someone with a chat on a task. */
export interface TaskPerson {
  readonly name: string;
  readonly mine: boolean;
}

/** The people with chats on a task, you first, each once. */
export function taskPeople(task: Pick<WorkTaskNode, "threads">): ReadonlyArray<TaskPerson> {
  const people = new Map<string, TaskPerson>();
  for (const thread of task.threads) {
    const key = `${thread.mine}:${thread.person}`;
    if (!people.has(key)) people.set(key, { name: thread.person, mine: thread.mine });
  }
  return [...people.values()].sort((a, b) => Number(b.mine) - Number(a.mine));
}

/** What opening a task does: its review, or one of its chats. */
export type TaskTarget =
  | {
      /** The task's own page, or its review. */
      readonly kind: "task" | "review";
      readonly workspace: string;
      readonly project: string;
      readonly task: string;
    }
  | { readonly kind: "chat"; readonly open: WorkOpen };

/** The one thing a task that waits on the person asks of them. */
export interface TaskAction {
  readonly label: "Review" | "Approve" | "Answer";
  readonly target: TaskTarget;
}

/** One task on the board or in the list. */
export interface WorkTaskCard extends CardPlace<TaskColumn | null> {
  readonly kind: "task";
  readonly task: WorkTaskNode;
  /** Its area; null for a task in none. */
  readonly area: string | null;
  readonly state: TaskState;
  /** Chats on it, everyone's, also those the person can't open. */
  readonly chats: number;
  readonly people: ReadonlyArray<TaskPerson>;
  /** The later of the Hub's last word on the task and the last activity of its chats here. */
  readonly updatedAt: string | undefined;
  /** What the task asks of the person, when it waits on them. */
  readonly action: TaskAction | undefined;
  /** Who owns it, its own owner or its area's; undefined for a task nobody owns, and without ownership. */
  readonly owner: TaskOwnerView | undefined;
  /** For a task in review: whom the review asks, and whether that is the person. */
  readonly review: ReviewRoute | undefined;
}

/**
 * One card of the board by task: a task, or something else that waits on the person. A column of
 * null is a done task: no column of the board, a row under Done in the list.
 */
export type TaskCard = WorkTaskCard | NeedCard | ChatNeedCard;

function reviewTarget(project: WorkProjectNode, task: WorkTaskNode): TaskTarget {
  return {
    kind: "review",
    workspace: project.workspace,
    project: project.projectId,
    task: task.id,
  };
}

/**
 * Where a task opens, from its card or its row: the task's own page, with or without an agent on
 * it. Every card and row opens a task through this one function; what waits on the person opens
 * through its action instead (`taskAction`).
 */
export function taskTarget(card: Pick<WorkTaskCard, "project" | "task">): TaskTarget {
  return {
    kind: "task",
    workspace: card.project.workspace,
    project: card.project.projectId,
    task: card.task.id,
  };
}

/**
 * What a task that waits on the person asks of them: its review, or the chat of theirs that waits
 * for the approval (or the answer). Undefined when nothing waits, or the chat can't be opened here.
 */
function taskAction(
  project: WorkProjectNode,
  task: WorkTaskNode,
  state: TaskState,
  needOf: ReadonlyMap<string, AgentNeed>,
): TaskAction | undefined {
  // A person named on a handoff answers on its page, not in a chat.
  if (state.kind === "review" || state.label === HANDOFF_CLASS_LABEL.human_decision)
    return { label: "Review", target: reviewTarget(project, task) };
  if (state.kind !== "approval" && state.kind !== "input") return undefined;
  const waiting = task.threads.filter(
    (thread) => thread.mine && !thread.stale && thread.status === "blocked",
  );
  const approving = (thread: WorkThreadNode) =>
    thread.open !== undefined && needOf.get(openKey(thread.open)) === "approval";
  const chat =
    state.kind === "approval"
      ? waiting.find(approving)
      : (waiting.find((thread) => !approving(thread)) ?? waiting[0]);
  return chat?.open === undefined
    ? undefined
    : {
        label: state.kind === "approval" ? "Approve" : "Answer",
        target: { kind: "chat", open: chat.open },
      };
}

function timeOf(at: string | undefined): number {
  const time = at === undefined ? Number.NaN : Date.parse(at);
  return Number.isFinite(time) ? time : 0;
}

/** The later of the Hub's last word on a task and the last activity of its chats on this computer. */
function taskUpdatedAt(project: WorkProjectNode, task: WorkTaskNode): string | undefined {
  const hub = project.tasks.find((candidate) => candidate.id === task.id)?.updatedAt;
  let latest: string | undefined;
  for (const at of [hub, ...task.threads.map((thread) => thread.activeAt)]) {
    if (timeOf(at) > timeOf(latest)) latest = at;
  }
  return latest;
}

/**
 * Your chats and agents on no task that wait for your approval or answer, one card each. One on a
 * task is that task's state already ("Needs your approval"), and a finished turn waits on nobody.
 */
/** What waits on a person besides tasks and chats: what asks for a decision, no agent's upkeep. */
function personNeedCards(
  tree: ReadonlyArray<WorkProjectNode>,
  needs: ReadonlyArray<NeedsYouItem>,
): ReadonlyArray<NeedCard> {
  return needCards(tree, needs).filter((card) => card.kind !== "stale");
}

function chatNeedCards(
  tree: ReadonlyArray<WorkProjectNode>,
  needs: ReadonlyArray<NeedsYouItem>,
): ReadonlyArray<ChatNeedCard> {
  const onTask = new Set(
    tree.flatMap((project) =>
      project.areas.flatMap((area) =>
        area.tasks.flatMap((task) =>
          task.threads.flatMap((thread) =>
            thread.open === undefined ? [] : [openKey(thread.open)],
          ),
        ),
      ),
    ),
  );
  const byOpen = projectsByOpen(tree);
  const projects = new Map(tree.map((project) => [projectScopeKey(project), project]));
  return needs.flatMap((item): ChatNeedCard[] => {
    if ((item.kind !== "thread" && item.kind !== "agent") || item.need === "review") return [];
    const opens = openKey(item.open);
    const project = projects.get(byOpen.get(opens) ?? "");
    if (onTask.has(opens) || project === undefined) return [];
    return [
      {
        kind: "chat",
        key: `${projectScopeKey(project)}:${item.key}`,
        column: "needs",
        project,
        task: undefined,
        item,
      },
    ];
  });
}

/**
 * A task's owner and, for a task in review, whom its review asks: what a card says of them. A view
 * that words the state itself (`taskState`) passes the route, or the state reads as it did before
 * ownership: a review asks everyone.
 */
export function taskOwnership(
  project: Pick<WorkProjectNode, "ownership">,
  task: Pick<WorkTaskNode, "id" | "inReview">,
  area: string | null,
): { readonly owner: TaskOwnerView | undefined; readonly review: ReviewRoute | undefined } {
  const owner = taskOwnerView(project.ownership, {
    id: task.id,
    ...(area === null ? {} : { area }),
  });
  // A review asks the task's owner, else the project's leads, else every member; without
  // ownership it asks everyone, as before.
  return {
    owner,
    review: task.inReview === true ? reviewRoute(project.ownership, owner) : undefined,
  };
}

function projectTaskCards(
  project: WorkProjectNode,
  needOf: ReadonlyMap<string, AgentNeed>,
): ReadonlyArray<WorkTaskCard> {
  return project.areas.flatMap((area) =>
    area.tasks.map((task): WorkTaskCard => {
      const { owner, review } = taskOwnership(project, task, area.name);
      const state = taskState(task, needOf, review);
      return {
        kind: "task",
        key: `${projectScopeKey(project)}:${task.id}`,
        column: taskColumn(state),
        project,
        task,
        area: area.name,
        state,
        chats: task.threads.length,
        people: taskPeople(task),
        updatedAt: taskUpdatedAt(project, task),
        action: taskAction(project, task, state, needOf),
        owner,
        review,
      };
    }),
  );
}

/** Whether the person created the task: the Hub keeps its creator's address. */
function createdBy(card: WorkTaskCard, me: string | null): boolean {
  return (
    me !== null &&
    card.project.tasks.some((task) => task.id === card.task.id && task.createdBy === me)
  );
}

/**
 * Yours are the tasks with a chat of yours, created by you or owned by you (its own owner, or its
 * area's), and every card under Needs you: what waits on the person is theirs, whoever's chat it is.
 */
function taskCardIsMine(card: TaskCard, me: string | null): boolean {
  return (
    card.kind !== "task" ||
    card.column === "needs" ||
    card.task.threads.some((thread) => thread.mine) ||
    card.owner?.mine === true ||
    createdBy(card, me)
  );
}

function taskCardTexts(card: TaskCard): ReadonlyArray<string | undefined> {
  if (card.kind === "chat") return [card.item.title];
  if (card.kind !== "task") return needTexts(card);
  return [
    card.task.title,
    card.area ?? "No area",
    card.state.label,
    card.owner?.name,
    ...card.task.threads.flatMap((thread) => [thread.title, thread.branch, thread.person]),
  ];
}

function taskCardTitle(card: TaskCard): string {
  return card.kind === "task" ? card.task.title : card.item.title;
}

/**
 * What waits first: an approval, an answer, a request, an overlap, stale inputs, a review; then
 * the rest.
 */
function taskCardRank(card: TaskCard): number {
  if (card.kind !== "task") return card.item.rank;
  switch (card.state.kind) {
    case "approval":
      return 0;
    case "input":
      return 1;
    case "review":
      return 5;
    default:
      return 6;
  }
}

/** Your own work first, then what waits first, then what was active last, then by title. */
function byTaskRelevance(a: TaskCard, b: TaskCard): number {
  const own = (card: TaskCard) =>
    card.kind !== "task" || card.task.threads.some((thread) => thread.mine);
  const at = (card: TaskCard) => timeOf(card.kind === "task" ? card.updatedAt : card.item.since);
  return (
    Number(own(b)) - Number(own(a)) ||
    taskCardRank(a) - taskCardRank(b) ||
    at(b) - at(a) ||
    taskCardTitle(a).localeCompare(taskCardTitle(b))
  );
}

/**
 * The cards by task in scope, only yours when `mine` (`me` is the person's address, for the tasks
 * they created), matching the search: every task, done ones too (their column is null), and the
 * cards for requests, overlaps and stale inputs that `needs` (Needs you's items) holds. `needs`
 * also says what each of your waiting chats waits for. The board shows the cards with a column,
 * and the sidebar counts those in `needs`.
 */
export function taskCards(
  tree: ReadonlyArray<WorkProjectNode>,
  input: {
    readonly scope: string;
    readonly mine: boolean;
    readonly query: string;
    readonly needs?: ReadonlyArray<NeedsYouItem>;
    readonly me?: string | null;
  },
): ReadonlyArray<TaskCard> {
  const query = input.query.trim().toLowerCase();
  const needs = input.needs ?? [];
  const me = input.me ?? null;
  const needOf = needsByOpen(needs);
  const scoped = tree.filter((project) => inScope(input.scope, project));
  return [
    ...scoped.flatMap((project) => projectTaskCards(project, needOf)),
    ...personNeedCards(scoped, needs),
    ...chatNeedCards(scoped, needs),
  ]
    .filter(
      (card) =>
        (!input.mine || taskCardIsMine(card, me)) &&
        textsMatch(
          [...taskCardTexts(card), card.task?.key, card.task?.title, card.project.name],
          query,
        ),
    )
    .sort(byTaskRelevance);
}

/**
 * How many cards of a project sit in each column, and how many of its tasks are active and done.
 * Requests, overlaps and stale inputs (with `needs`) count under Needs you but not as tasks.
 */
export type TaskCounts = Readonly<Record<TaskColumn, number>> & {
  readonly active: number;
  readonly done: number;
};

/** A project's counts (all of its cards, or only yours), from the same cards `taskCards` makes. */
export function taskCounts(
  project: WorkProjectNode,
  mine = false,
  needs: ReadonlyArray<NeedsYouItem> = [],
  me: string | null = null,
): TaskCounts {
  const counts = { needs: 0, working: 0, paused: 0, new: 0, active: 0, done: 0 };
  for (const card of [
    ...projectTaskCards(project, needsByOpen(needs)),
    ...personNeedCards([project], needs),
    ...chatNeedCards([project], needs),
  ]) {
    if (mine && !taskCardIsMine(card, me)) continue;
    if (card.column !== null) counts[card.column] += 1;
    if (card.kind === "task") counts[card.column === null ? "done" : "active"] += 1;
  }
  return counts;
}

/**
 * How many of your chats in scope are on no task and not delivered, for the line under the board
 * (they are the Chats view's). The search narrows them like it does the cards.
 */
export function unsortedChats(
  tree: ReadonlyArray<WorkProjectNode>,
  input: { readonly scope: string; readonly query?: string },
): number {
  const query = (input.query ?? "").trim().toLowerCase();
  return tree
    .filter((project) => inScope(input.scope, project))
    .reduce(
      (total, project) =>
        total +
        project.unsorted.filter(
          (thread) =>
            thread.mine &&
            thread.delivery !== "merged" &&
            thread.delivery !== "closed" &&
            textsMatch([thread.title, thread.branch, project.name], query),
        ).length,
      0,
    );
}

/** The latest handoff of a task, as its card says it. */
export interface TaskHandoff {
  readonly number: number;
  /** Who composed it, by name. */
  readonly author: string;
  readonly mine: boolean;
  /** An agent composed it for its person, else the person did. */
  readonly byAgent: boolean;
  readonly at: string;
}

/** The task's latest handoff package, when the Hub reports one. */
export function taskHandoff(
  status: PeerHubStatus,
  project: Pick<WorkProjectNode, "workspace" | "projectId">,
  task: Pick<WorkTaskNode, "id">,
): TaskHandoff | undefined {
  let latest: NonNullable<PeerHubStatus["handoff"]>["summaries"][number] | undefined;
  for (const summary of status.handoff?.summaries ?? []) {
    if (
      summary.workspace === project.workspace &&
      summary.project === project.projectId &&
      summary.task === task.id &&
      (latest === undefined || summary.number > latest.number)
    ) {
      latest = summary;
    }
  }
  return latest === undefined
    ? undefined
    : {
        number: latest.number,
        author: personName(status, project.workspace, latest.author),
        mine: latest.author === status.email,
        byAgent: latest.source === "agent",
        at: latest.composedAt,
      };
}

/** A card's one line of why it is where it is, and when that happened (to follow the text). */
export interface TaskWhy {
  readonly text: string;
  readonly at: string | undefined;
}

/** "your chat", or "Ana’s chat". */
function chatOf(thread: Pick<WorkThreadNode, "mine" | "person">): string {
  return thread.mine ? "your chat" : `${thread.person}’s chat`;
}

/**
 * The line under a task card's state: whose chat is working or waiting, or which handoff waits
 * for review, with the agent's name when `agentName` knows it (for a chat on another computer
 * that is whatever it reported). The question an agent asks you is not in the work tree, so the
 * line says that it asks.
 */
export function taskWhy(
  card: Pick<WorkTaskCard, "task" | "state" | "updatedAt" | "chats">,
  input: {
    readonly handoff: TaskHandoff | undefined;
    readonly agentName: (thread: WorkThreadNode) => string | undefined;
  },
): TaskWhy {
  const { task, state } = card;
  const live = task.threads.filter((thread) => !thread.stale);
  /** The handoff a review is of, in a line; `missing` says it when the Hub reports none. */
  const handoffLine = (missing: string): TaskWhy => {
    const { handoff } = input;
    if (handoff === undefined) return { text: missing, at: undefined };
    // The agent that wrote it, when the author has exactly one chat on the task to tell by.
    const chats = task.threads.filter((thread) =>
      handoff.mine ? thread.mine : !thread.mine && thread.person === handoff.author,
    );
    const agent = handoff.byAgent && chats.length === 1 ? input.agentName(chats[0]!) : undefined;
    const from =
      agent === undefined
        ? `from ${handoff.mine ? "you" : handoff.author}`
        : `from ${agent} in ${chatOf(chats[0]!)}`;
    return { text: `Handoff #${handoff.number} ${from}`, at: handoff.at };
  };
  switch (state.kind) {
    case "done":
      return { text: "Done", at: card.updatedAt };
    case "review":
      return handoffLine("A handoff waits for your review");
    case "accepted":
      return {
        text:
          task.accepted === "policy"
            ? "Accepted by policy · waiting to land"
            : "Accepted · waiting to land",
        at: card.updatedAt,
      };
    case "agent_action":
      return { text: "With the agent", at: state.since };
    case "coordination":
      return handoffLine("Coordination needed");
    case "approval":
    case "input": {
      if (task.inReview === true && state.label === HANDOFF_CLASS_LABEL.human_decision)
        return handoffLine("A person's decision is needed");
      const chat = live.find((thread) => thread.mine && thread.status === "blocked");
      const agent = chat === undefined ? undefined : input.agentName(chat);
      const who = agent ?? "A chat of yours";
      // A chat of yours on another computer waits there; this one can't open it.
      const where = chat?.localEnvironment === false ? " on your other computer" : "";
      return {
        text: `${who} ${state.kind === "approval" ? "needs your approval" : "asks you a question"}${where}`,
        at: chat?.activeAt,
      };
    }
    case "working": {
      const working = live.filter((thread) => thread.status === "working");
      const chat = working[0];
      if (chat === undefined) return { text: "In progress", at: card.updatedAt };
      const agent = input.agentName(chat);
      const more = working.length - 1;
      return {
        text: `${agent === undefined ? "Working" : `${agent} is working`} in ${chatOf(chat)}${
          more > 0 ? ` and ${more} more` : ""
        }`,
        at: chat.activeAt,
      };
    }
    case "waiting": {
      // A review that asks someone else waits on them, not on a chat.
      if (task.inReview === true) return handoffLine("A handoff waits for review");
      const chat = live.find((thread) => !thread.mine && thread.status === "blocked");
      const agent = chat === undefined ? undefined : input.agentName(chat);
      const whose = `${state.waitingOn ?? "A colleague"}’s chat`;
      return {
        text: `${agent === undefined ? whose : `${agent} in ${whose}`} waits for an answer or an approval`,
        at: undefined,
      };
    }
    case "paused":
      return {
        text: `${card.chats === 1 ? "Its chat" : "Its chats"} stopped without a handoff`,
        at: card.updatedAt,
      };
    case "new":
      return { text: "No chat yet. Start one, or request a teammate.", at: undefined };
  }
}

/** How long before `now` a time was, in words: "yesterday", "3 days ago". */
export function agoInWords(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 2) return "yesterday";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks < 9 ? `${weeks} weeks ago` : `${Math.floor(days / 30)} months ago`;
}

/**
 * What an agent's harness is called, as the Threads list names the agents it knows; undefined for
 * one nobody named.
 */
export function harnessName(harness: string | undefined): string | undefined {
  const name = harness?.trim().toLowerCase();
  if (name === undefined || name === "") return undefined;
  switch (name) {
    case "claude":
    case "claude-code":
      return "Claude";
    case "codex":
      return "Codex";
    case "cursor":
    case "cursor-agent":
      return "Cursor";
    case "opencode":
      return "OpenCode";
    default:
      return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  }
}

/** The line under the board for the tasks that are done: "Done: 2 tasks, the last one yesterday". */
export function doneLine(
  done: ReadonlyArray<Pick<WorkTaskCard, "updatedAt">>,
  now: number,
): string | null {
  if (done.length === 0) return null;
  const last = Math.max(...done.map((card) => timeOf(card.updatedAt)));
  const when = last > 0 ? agoInWords(last, now) : undefined;
  if (done.length === 1) return `Done: 1 task${when === undefined ? "" : `, finished ${when}`}`;
  return `Done: ${done.length} tasks${when === undefined ? "" : `, the last one ${when}`}`;
}

/** All of a project's tasks, in the order the tree lists them. */
export function projectTaskCount(project: WorkProjectNode): number {
  return project.areas.reduce((total, area) => total + area.tasks.length, 0);
}

/** What each thread opens (`openKey`), mapped to the project the tree placed it in. */
function projectsByOpen(tree: ReadonlyArray<WorkProjectNode>): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const project of tree) {
    const key = projectScopeKey(project);
    const threads = [
      ...project.areas.flatMap((area) => area.tasks.flatMap((task) => task.threads)),
      ...project.unsorted,
    ];
    for (const thread of threads) {
      if (thread.open !== undefined) map.set(openKey(thread.open), key);
    }
  }
  return map;
}

/**
 * The project a Needs you item concerns, as a scope key: a request's or an overlap's project, the
 * project of the session whose inputs went stale, or the project the tree placed the waiting
 * thread in. Undefined when it names none, so it shows whatever project is in scope.
 */
export function needProject(
  item: NeedsYouItem,
  byOpen: ReadonlyMap<string, string>,
): string | undefined {
  return item.kind === "thread" || item.kind === "agent"
    ? byOpen.get(openKey(item.open))
    : itemProject(item);
}
