import {
  activeAgents,
  localThreadStatus,
  personName,
  taskLabel,
  type WorkAgent,
  type WorkOpen,
} from "@t3tools/client-runtime/peer/needs-you";
export {
  activeAgents,
  localThreadStatus,
  personName,
  taskLabel,
  type AgentNeed,
  type ActiveAgentNode,
  type WorkAgent,
  type WorkOpen,
} from "@t3tools/client-runtime/peer/needs-you";
/**
 * The work tree: Project → Area → Task → Threads. The hierarchy follows the
 * product and the work; the person is metadata on a thread, never a level.
 *
 * This computer's threads come live from its own thread list (and herdr);
 * other people's and other computers' come from the hub. A thread sits under
 * the task it was placed on, else the task its branch or title names by key
 * (`krk-812-split` → KRK-812), else under the project's unsorted work.
 */
import type {
  EnvironmentId,
  PeerHubStatus,
  PeerLocalAgent,
  PeerProjectState,
  PeerTask,
  PeerWorkStatus,
  PeerWorkDelivery,
  PeerWorkspaceState,
  ThreadId,
} from "@t3tools/contracts";
import { type EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

/** A colleague's thread nobody has reported for this long shows as no longer live. */
export const STALE_AFTER_MS = 3 * 60 * 1000;

export interface WorkThreadNode {
  readonly delivery?: PeerWorkDelivery;
  readonly localEnvironment?: boolean;
  readonly key: string;
  readonly title: string;
  readonly person: string;
  readonly mine: boolean;
  readonly status: PeerWorkStatus;
  readonly harness: string | undefined;
  readonly branch: string | undefined;
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
  /** What the task's threads add up to: blocked beats working beats the rest. */
  readonly status: PeerWorkStatus;
  readonly threads: ReadonlyArray<WorkThreadNode>;
  /** Its creator, the project's leads and the workspace's admins may remove it. */
  readonly removable: boolean;
  /** Its shared context, once an agent on it started one. */
  readonly context: WorkContextNode | undefined;
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
  /** What the work's agents found since it last changed: for its keeper to fold in, newest first. */
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
function byActivity(a: WorkThreadNode, b: WorkThreadNode): number {
  return (
    Number(b.mine) - Number(a.mine) ||
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    a.title.localeCompare(b.title)
  );
}

function rollup(threads: ReadonlyArray<WorkThreadNode>, done: boolean): PeerWorkStatus {
  if (threads.some((t) => !t.stale && t.status === "blocked")) return "blocked";
  if (threads.some((t) => !t.stale && t.status === "working")) return "working";
  if (
    done ||
    (threads.length > 0 && threads.every((t) => t.delivery === "merged" || t.delivery === "closed"))
  )
    return "done";
  return "idle";
}

/** A shared context as the tree shows it, with what was found on its work since it last changed. */
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
  const since = context.version === 0 ? 0 : Date.parse(context.updatedAt);
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
          Date.parse(finding.at) > since,
      )
      .map((finding) => ({
        id: finding.id,
        person: personName(state, finding.email),
        text: finding.text,
        at: finding.at,
      })),
  };
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
      task: taskOf(work.assignments[key], [thread.branch, thread.title]),
      node: {
        key,
        title: thread.title,
        person: myName,
        mine: true,
        status: localThreadStatus(thread),
        delivery: localRecord(key)?.delivery ?? "open",
        localEnvironment: true,
        harness: undefined,
        branch: thread.branch ?? undefined,
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
      task: taskOf(work.assignments[key] ?? work.assignments[agent.id], [
        agent.branch,
        agent.title,
      ]),
      node: {
        key,
        title: agent.title,
        person: myName,
        mine: true,
        status: agent.status,
        delivery: record?.delivery ?? "open",
        localEnvironment: true,
        harness: agent.agent,
        branch: agent.branch,
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
      task: taskOf(localEnvironment ? (work.assignments[thread.id] ?? thread.task) : thread.task, [
        thread.branch,
        thread.title,
      ]),
      node: {
        key: localEnvironment ? thread.id : `${thread.environment}:${thread.id}`,
        title: thread.title,
        person: personName(state, thread.email),
        mine: thread.email === me,
        status: stale ? "unknown" : thread.status,
        delivery: thread.delivery ?? "open",
        localEnvironment,
        harness: thread.harness,
        branch: thread.branch,
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
  const taskNodes = new Map<string, WorkTaskNode>();
  for (const task of work.tasks) {
    const context = contextNode(status, workspace.slug, state, `task:${task.id}`);
    const threads = placed
      .filter((entry) => entry.task === task.id)
      .map((entry) => keeping(context)(entry.node))
      .toSorted(byActivity);
    taskNodes.set(task.id, {
      id: task.id,
      key: task.key,
      title: task.title,
      done: task.status === "done",
      status: rollup(threads, task.status === "done"),
      threads,
      removable:
        task.createdBy === me || state.project.role === "lead" || workspace.role !== "member",
      context,
    });
  }
  const projectContext = contextNode(status, workspace.slug, state, "project");
  // Areas the project declares come first, in its order; then those tasks name; then no area.
  const areaNames = [...work.areas];
  for (const task of work.tasks) {
    if (task.area !== undefined && !areaNames.includes(task.area)) areaNames.push(task.area);
  }
  const areas: WorkAreaNode[] = areaNames.map((name) => ({
    name,
    tasks: work.tasks.filter((t) => t.area === name).flatMap((t) => taskNodes.get(t.id) ?? []),
  }));
  const loose = work.tasks.filter((t) => t.area === undefined);
  if (loose.length > 0) {
    areas.push({ name: null, tasks: loose.flatMap((t) => taskNodes.get(t.id) ?? []) });
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
      .toSorted(byActivity),
    context: projectContext,
    candidates:
      status.coordination.candidates.find(
        (waiting) => waiting.workspace === workspace.slug && waiting.project === state.project.id,
      )?.proposed ?? 0,
    tasks: work.tasks,
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
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
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

/** A context's size the way people read it: `~2.1k tokens`. */
export function contextSize(tokens: number): string {
  return tokens >= 1000 ? `~${(tokens / 1000).toFixed(1)}k tokens` : `~${tokens} tokens`;
}

/** What the open route shows, in the terms of `WorkOpen`, to highlight it in the tree. */
export function openKey(open: WorkOpen): string {
  return open.kind === "thread"
    ? `${open.environmentId}:${open.threadId}`
    : open.kind === "herdr"
      ? `agent:${open.agentId}`
      : `observe:${open.workspace}:${open.environment}:${open.thread}`;
}
