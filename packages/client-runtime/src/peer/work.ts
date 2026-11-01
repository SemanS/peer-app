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
 * A project scope (one project, or all of them) is shared by the views so they show the same work.
 */
import {
  localThreadStatus,
  personName,
  type AgentNeed,
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
import { projectVcs, type PeerVcsKind } from "./vcsWords.ts";

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

export interface WorkTaskNode {
  readonly id: string;
  readonly key: string | undefined;
  readonly title: string;
  readonly done: boolean;
  /** The Hub has it in review: its work is ready for a person to look at. */
  readonly inReview?: boolean;
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
  readonly tasks: ReadonlyArray<PeerTask>;
  /** Open rooms bound to no work item, newest first; none of them is among `areas` or `tasks`. */
  readonly chats?: ReadonlyArray<WorkTaskNode>;
  /** The version control of the project's checkouts on this computer. */
  readonly vcs?: PeerVcsKind | undefined;
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
  | "approval"
  | "input"
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
}

const TASK_STATE_LABEL: Readonly<Record<Exclude<TaskStateKind, "waiting">, string>> = {
  done: "Done",
  review: "Ready for review",
  approval: "Needs your approval",
  input: "Needs your answer",
  working: "In progress",
  paused: "Paused",
  new: "Not started",
};

/**
 * A task's state, the first rule that matches: the Hub's done (or every pull request merged or
 * closed) and review come first, then what your own chats wait for, then any chat at work, a
 * colleague's chat waiting on them, chats that stopped, and no chat at all. A colleague's chat nobody
 * reports any more neither works nor waits. `needs` tells an approval from an answer; without it a
 * waiting chat of yours reads as an answer.
 */
export function taskState(
  task: WorkTaskNode,
  needs: ReadonlyMap<string, AgentNeed> = new Map(),
): TaskState {
  const state = (kind: Exclude<TaskStateKind, "waiting">): TaskState => ({
    kind,
    label: TASK_STATE_LABEL[kind],
    waitingOn: undefined,
  });
  if (task.done || task.status === "done") return state("done");
  if (task.inReview === true) return state("review");
  const live = task.threads.filter((thread) => !thread.stale);
  const waitingMine = live.filter((thread) => thread.mine && thread.status === "blocked");
  if (
    waitingMine.some(
      (thread) => thread.open !== undefined && needs.get(openKey(thread.open)) === "approval",
    )
  )
    return state("approval");
  if (waitingMine.length > 0) return state("input");
  if (live.some((thread) => thread.status === "working")) return state("working");
  const waiting = live.find((thread) => !thread.mine && thread.status === "blocked");
  if (waiting !== undefined)
    return { kind: "waiting", label: `Blocked on ${waiting.person}`, waitingOn: waiting.person };
  return state(task.threads.length > 0 ? "paused" : "new");
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
  const items = work.tasks.filter((task) => task.chat !== true);
  const tree = taskTree(items);
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
    tasks: items,
    chats: work.tasks
      .filter((task) => task.chat === true && task.status !== "done")
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((task) => taskNodes.get(task.id) ?? []),
    vcs: projectVcs(state.repositories),
  };
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
    "Mark each item done with peer task set <id> --status done as you finish it; peer ready says the scope is done.",
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
      "Mark each item done with peer task set <id> --status done as you finish it; peer ready says the group is done.",
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

export function inScope(scope: string, project: WorkProjectNode): boolean {
  return scope === ALL_PROJECTS || projectScopeKey(project) === scope;
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
