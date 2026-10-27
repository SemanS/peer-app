import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";
import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import {
  BOARD_COLUMNS,
  boardCards,
  buildWorkTree,
  byActivity,
  projectScopeKey,
  rollup,
  type BoardCard,
  type BoardColumn,
  type WorkProjectNode,
  type WorkThreadNode,
} from "@t3tools/client-runtime/peer/work";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, PeerHubStatus, ThreadId } from "@t3tools/contracts";

/** A computer the phone knows, with the Peer status it reports. */
export interface WorkEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  /** Its status; while it is away, the last one it reported; null before the first. */
  readonly status: PeerHubStatus | null;
  /** Why its status could not be read just now. */
  readonly error: string | null;
}

/**
 * Each computer with the status the screen shows for it: the live one, else the last it
 * reported, so a computer that went away keeps its work on screen. `last` is what to remember for
 * the next read: the statuses of the computers the phone still knows.
 */
export function mergeWorkEnvironments(
  environments: ReadonlyArray<WorkEnvironment>,
  previous: ReadonlyMap<string, PeerHubStatus>,
) {
  const merged = environments.map((environment) => ({
    ...environment,
    status: environment.status ?? previous.get(environment.environmentId) ?? null,
  }));
  const last = new Map<string, PeerHubStatus>();
  for (const environment of merged) {
    if (environment.status !== null) last.set(environment.environmentId, environment.status);
  }
  return { environments: merged, last };
}

/** The team's work over every computer the phone knows. */
export interface MobileWork {
  /** Each project once, with the threads of every computer, each thread once. */
  readonly tree: ReadonlyArray<WorkProjectNode>;
  /** The computer whose status reports each project, by scope key: it gives the project's signals. */
  readonly sources: ReadonlyMap<string, EnvironmentId>;
  /** The computer that runs each thread or agent of the phone's own computers, by thread key. */
  readonly hosts: ReadonlyMap<string, EnvironmentId>;
}

interface Placement {
  readonly project: string;
  /** The task the thread is on; null for work on no task. */
  readonly task: string | null;
  readonly node: WorkThreadNode;
  readonly host: EnvironmentId | undefined;
  /** Which view of the thread wins: its own computer's over the Hub's report, connected over away. */
  readonly rank: number;
}

/**
 * The team's work as the phone shows it: each computer's tree, as web builds it on one, merged so
 * a project and a thread show once. A thread is known by the computer that runs it and the id the
 * Hub gives it, the key other computers' trees already use. Its own computer's live view wins
 * while that computer is connected, then a connected computer's report through the Hub, then what
 * an away computer last said. A project's areas and tasks come from the first connected computer
 * that reports it.
 */
export function mobileWork(input: {
  readonly environments: ReadonlyArray<WorkEnvironment>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly now: number;
}): MobileWork {
  const ordered = [...input.environments].sort((a, b) => Number(b.connected) - Number(a.connected));
  const projects = new Map<string, WorkProjectNode>();
  const sources = new Map<string, EnvironmentId>();
  const chosen = new Map<string, Placement>();
  for (const environment of ordered) {
    const { status } = environment;
    if (status === null || !status.signedIn) continue;
    const tree = buildWorkTree({
      status,
      localThreads: input.threads,
      now: input.now,
      watch: activePlugin(status, "observe"),
    });
    for (const project of tree) {
      const key = projectScopeKey(project);
      if (!projects.has(key)) {
        projects.set(key, project);
        sources.set(key, environment.environmentId);
      }
      const place = (task: string | null, node: WorkThreadNode) => {
        const own = node.localEnvironment === true;
        const id = own ? `${status.environmentId}:${node.key}` : node.key;
        const rank = (environment.connected ? 2 : 0) + (own ? 1 : 0);
        const known = chosen.get(id);
        if (known !== undefined && known.rank >= rank) return;
        chosen.set(id, {
          project: key,
          task,
          node: { ...node, key: id },
          host: own ? environment.environmentId : undefined,
          rank,
        });
      };
      for (const area of project.areas) {
        for (const task of area.tasks) for (const node of task.threads) place(task.id, node);
      }
      for (const node of project.unsorted) place(null, node);
    }
  }

  const placed = new Map<string, Placement[]>();
  const hosts = new Map<string, EnvironmentId>();
  for (const [id, placement] of chosen) {
    const inProject = placed.get(placement.project);
    if (inProject === undefined) placed.set(placement.project, [placement]);
    else inProject.push(placement);
    if (placement.host !== undefined) hosts.set(id, placement.host);
  }
  const tree = [...projects].map(([key, project]): WorkProjectNode => {
    const placements = placed.get(key) ?? [];
    const taskIds = new Set(project.areas.flatMap((area) => area.tasks.map((task) => task.id)));
    // A thread on a task this computer does not know yet waits with the work on no task.
    const threadsOn = (task: string | null) =>
      placements
        .filter((placement) =>
          task === null
            ? placement.task === null || !taskIds.has(placement.task)
            : placement.task === task,
        )
        .map((placement) => placement.node)
        .sort(byActivity);
    return {
      ...project,
      areas: project.areas.map((area) => ({
        ...area,
        tasks: area.tasks.map((task) => {
          const threads = threadsOn(task.id);
          return { ...task, threads, status: rollup(threads, task.done) };
        }),
      })),
      unsorted: threadsOn(null),
    };
  });
  return { tree, sources, hosts };
}

export interface WorkGroup {
  readonly column: BoardColumn;
  readonly title: string;
  readonly cards: ReadonlyArray<BoardCard>;
}

/**
 * One project's work in the Work board's columns, in their order: Needs you, Working, Needs review
 * and Idle. Needs you also holds the requests, overlaps and stale inputs that wait on the person.
 */
export function workGroups(
  tree: ReadonlyArray<WorkProjectNode>,
  project: WorkProjectNode,
  needs: ReadonlyArray<NeedsYouItem>,
): ReadonlyArray<WorkGroup> {
  const cards = boardCards(tree, {
    scope: projectScopeKey(project),
    mine: false,
    query: "",
    needs,
  });
  return BOARD_COLUMNS.map((column) => ({
    column: column.id,
    title: column.title,
    cards: cards.filter((card) => card.column === column.id),
  }));
}

/** What tapping a card does on the phone; null when there is nothing to open. */
export type WorkCardAction =
  | { readonly kind: "stale"; readonly item: Extract<NeedsYouItem, { kind: "stale" }> }
  | { readonly kind: "thread"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId }
  | { readonly kind: "agent"; readonly environmentId: EnvironmentId; readonly agentId: string }
  | { readonly kind: "request"; readonly item: Extract<NeedsYouItem, { kind: "request" }> }
  /** The person decides it in the owner's call sheet, as Needs you does. */
  | { readonly kind: "owner-call"; readonly item: Extract<NeedsYouItem, { kind: "owner-call" }> }
  /** The person settles it in Needs you; the overlap's page is on web and desktop. */
  | { readonly kind: "overlap"; readonly item: Extract<NeedsYouItem, { kind: "overlap" }> }
  /** A page the phone does not have, or a thread on a computer that is away: why, in a line. */
  | { readonly kind: "unavailable"; readonly reason: string };

export function workCardAction(
  card: BoardCard,
  hosts: ReadonlyMap<string, EnvironmentId>,
  environments: ReadonlyArray<Pick<WorkEnvironment, "environmentId" | "label" | "connected">>,
): WorkCardAction | null {
  switch (card.kind) {
    case "request":
      return { kind: "request", item: card.item };
    case "overlap":
      return { kind: "overlap", item: card.item };
    case "stale":
      return { kind: "stale", item: card.item };
    case "owner-call":
      return { kind: "owner-call", item: card.item };
    case "thread":
      break;
  }
  const open = card.thread.open;
  if (open === undefined) return null;
  switch (open.kind) {
    case "observe":
      return { kind: "unavailable", reason: "Watch it live on web or desktop." };
    case "context":
      return { kind: "unavailable", reason: "Open the task context on web or desktop." };
    case "thread":
    case "herdr": {
      const host = hosts.get(card.thread.key);
      const environment = environments.find((candidate) => candidate.environmentId === host);
      if (environment === undefined) return null;
      if (!environment.connected) {
        return { kind: "unavailable", reason: `${environment.label} is offline.` };
      }
      return open.kind === "thread"
        ? { kind: "thread", environmentId: environment.environmentId, threadId: open.threadId }
        : { kind: "agent", environmentId: environment.environmentId, agentId: open.agentId };
    }
  }
}

/**
 * What the screen says about the computers: which are away (their work shows as they last
 * reported it), which could not be read, and which are not signed in to Peer.
 */
export function workNotices(environments: ReadonlyArray<WorkEnvironment>): ReadonlyArray<string> {
  return environments.flatMap((environment) => {
    if (!environment.connected) {
      return environment.status === null
        ? []
        : [`${environment.label} is offline. Its work shows as it last reported it.`];
    }
    if (environment.error !== null) return [`${environment.label}: ${environment.error}`];
    return [];
  });
}

/**
 * What the Home row says about the team's work: the project the Work screen shows, else how many
 * projects the computers report; null while none reports a team project.
 */
export function homeWorkSubtitle(
  statuses: ReadonlyArray<PeerHubStatus | null>,
  scope: string,
): string | null {
  const projects = new Map<string, string>();
  for (const status of statuses) {
    if (status?.signedIn !== true) continue;
    for (const workspace of status.workspaces) {
      for (const state of workspace.projects) {
        projects.set(`${workspace.slug}/${state.project.id}`, state.project.name);
      }
    }
  }
  if (projects.size === 0) return null;
  return (
    projects.get(scope) ??
    (projects.size === 1 ? "1 team project" : `${projects.size} team projects`)
  );
}

/** What the screen says while it has no project to show, or null once it has. */
export function workEmptyText(
  environments: ReadonlyArray<WorkEnvironment>,
  tree: ReadonlyArray<WorkProjectNode>,
): string | null {
  if (tree.length > 0) return null;
  if (
    environments.some(
      (environment) =>
        environment.connected && environment.status === null && environment.error === null,
    )
  ) {
    return "Loading your team’s work…";
  }
  const signedIn = environments.flatMap((environment) =>
    environment.status?.signedIn === true ? [environment.status] : [],
  );
  if (signedIn.length === 0)
    return "Local chats are available from Projects. Connect a Hub to add shared team tasks.";
  return signedIn.some((status) => status.workspaces.length > 0)
    ? "No team projects yet. Share one on web or desktop, and everyone in the workspace can work on it."
    : "Join or create a workspace on web or desktop to work with your team.";
}
