/** What web and mobile share of a person's agents and chats, and how they name people and work. */
import type {
  EnvironmentId,
  ThreadId,
  PeerHubStatus,
  PeerProjectState,
  PeerOverlap,
  PeerWorkStatus,
} from "@t3tools/contracts";
import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";
import { threadRuntimeIsActive, type EnvironmentThreadShell } from "../state/models.ts";

export type WorkOpen =
  | { readonly kind: "thread"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId }
  /** A herdr agent opens in Peer's agent view; its pane is where herdr shows it. */
  | { readonly kind: "herdr"; readonly agentId: string; readonly paneId: string }
  /** A thread on another computer whose owner shares it opens read-only, relayed by the hub. */
  | {
      readonly kind: "observe";
      readonly workspace: string;
      readonly environment: string;
      readonly thread: string;
    };

export type WorkAgent =
  | { readonly instanceId: string; readonly model: string }
  | { readonly harness: string };

/** A local thread's state: ◐ waiting on an answer, ● working, ✓ settled, ○ idle. */
export function localThreadStatus(thread: EnvironmentThreadShell): PeerWorkStatus {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "blocked";
  if (threadRuntimeIsActive(thread.runtime)) return "working";
  return thread.settledAt !== null ? "done" : "idle";
}

const STATUS_ORDER: Readonly<Record<PeerWorkStatus, number>> = {
  blocked: 0,
  working: 1,
  idle: 2,
  unknown: 3,
  done: 4,
};
/** Why an agent waits on you: an approval, an answer, or finished work to look at. */
export type AgentNeed = "approval" | "input" | "review";

export interface ActiveAgentNode {
  readonly key: string;
  readonly title: string;
  readonly status: PeerWorkStatus;
  readonly harness: string | undefined;
  /** The project it works in, and its task there, when there are. */
  readonly where: string | undefined;
  readonly open: WorkOpen;
  /** Set while it waits on you; unset while it just works. */
  readonly needs: AgentNeed | undefined;
  readonly agent: WorkAgent | undefined;
}

const NEED_ORDER: Readonly<Record<AgentNeed, number>> = { approval: 0, input: 1, review: 2 };

/**
 * What on this computer needs you, and what just runs: herdr's agents
 * (whatever started them) and this computer's threads. An agent needs you
 * while it waits for an approval or an answer, and once it finished work you
 * have not looked at yet; working ones are not news.
 */
export function activeAgents(input: {
  readonly status: PeerHubStatus | null;
  readonly localThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projectNames: ReadonlyMap<string, string>;
  readonly localEnvironmentId: EnvironmentId | null;
  /** A thread finished work its owner has not opened since. */
  readonly unseen: (thread: EnvironmentThreadShell) => boolean;
  /** Thread key (`peer:<id>`, `herdr:<id>`) → the task it is on, as the work tree places it. */
  readonly taskOf?: ReadonlyMap<string, string>;
}): ReadonlyArray<ActiveAgentNode> {
  const agents: ActiveAgentNode[] = [];
  const place = (key: string, project: string | undefined) => {
    const parts = [project, input.taskOf?.get(key)].filter((part) => part !== undefined);
    return parts.length === 0 ? undefined : parts.join(" · ");
  };
  const projectTitle = (workspace: string | undefined, projectId: string | undefined) =>
    workspace === undefined || projectId === undefined
      ? undefined
      : input.status?.workspaces
          .find((w) => w.slug === workspace)
          ?.projects.find((p) => p.project.id === projectId)?.project.name;
  for (const agent of input.status?.agents.list ?? []) {
    // herdr says "done" for finished work nobody has looked at, "idle" once someone has.
    const needs =
      agent.status === "blocked" ? "input" : agent.status === "done" ? "review" : undefined;
    if (needs === undefined && agent.status !== "working") continue;
    agents.push({
      key: agent.id,
      title: agent.title,
      status: agent.status,
      harness: agent.agent,
      where: place(
        agent.id,
        projectTitle(agent.workspace, agent.projectId) ?? agent.cwd?.split("/").at(-1),
      ),
      open: { kind: "herdr", agentId: agent.id, paneId: agent.paneId },
      needs,
      agent: agent.agent === undefined ? undefined : { harness: agent.agent },
    });
  }
  for (const thread of input.localThreads) {
    if (input.localEnvironmentId !== null && thread.environmentId !== input.localEnvironmentId) {
      continue;
    }
    if (thread.archivedAt !== null || thread.deletedAt !== null) continue;
    const status = localThreadStatus(thread);
    const needs: AgentNeed | undefined = thread.hasPendingApprovals
      ? "approval"
      : thread.hasPendingUserInput
        ? "input"
        : status !== "working" && input.unseen(thread)
          ? "review"
          : undefined;
    if (needs === undefined && status !== "working") continue;
    const key = `peer:${thread.id}`;
    agents.push({
      key,
      title: thread.title,
      status,
      harness: undefined,
      where: place(key, input.projectNames.get(`${thread.environmentId}:${thread.projectId}`)),
      open: { kind: "thread", environmentId: thread.environmentId, threadId: thread.id },
      needs,
      agent: {
        instanceId: thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId,
        model: thread.modelSelection.model,
      },
    });
  }
  const rank = (agent: ActiveAgentNode) =>
    agent.needs === undefined ? 3 + STATUS_ORDER[agent.status] : NEED_ORDER[agent.needs];
  return agents.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

/** A task the way lists and menus name it: `KRK-812 · Split Payments`. */
export function taskLabel(task: { readonly key?: string | undefined; readonly title: string }) {
  return task.key ? `${task.key} · ${task.title}` : task.title;
}

/** A project member's name; the status form searches every project of one workspace. */
export function personName(project: PeerProjectState, email: string): string;
export function personName(status: PeerHubStatus, workspace: string, email: string): string;
export function personName(
  source: PeerProjectState | PeerHubStatus,
  workspaceOrEmail: string,
  email?: string,
): string {
  if ("project" in source)
    return (
      source.project.members.find((member) => member.email === workspaceOrEmail)?.name ??
      workspaceOrEmail.split("@")[0] ??
      workspaceOrEmail
    );
  if (workspaceOrEmail === PEER_LOCAL_WORKSPACE) return "You";
  const address = email ?? workspaceOrEmail;
  const projects =
    source.workspaces.find((workspace) => workspace.slug === workspaceOrEmail)?.projects ?? [];
  for (const state of projects) {
    const name = state.project.members.find((member) => member.email === address)?.name;
    if (name !== undefined && name !== "") return name;
  }
  const local = address.split("@")[0]?.split(/[._-]/)[0] ?? address;
  return local === "" ? address : `${local[0]?.toUpperCase() ?? ""}${local.slice(1)}`;
}

/** The tasks of the project an overlap is in. */
export function projectTasks(status: PeerHubStatus, overlap: PeerOverlap) {
  return (
    status.workspaces
      .find((w) => w.slug === overlap.workspace)
      ?.projects.find((p) => p.project.id === overlap.project)?.work.tasks ?? []
  );
}

/**
 * What an overlap is about: the files both agents change, or the task one
 * agent asked the agents of (`peer ask` claims `task:<id>`).
 */
export function overlapTopic(status: PeerHubStatus, overlap: PeerOverlap): string {
  const tasks = projectTasks(status, overlap);
  const asked = overlap.files.flatMap((path) => {
    if (!path.startsWith("task:")) return [];
    const id = path.slice("task:".length);
    const task = tasks.find((candidate) => candidate.id === id);
    return [task === undefined ? id : taskLabel(task)];
  });
  const resources = overlap.files
    .filter((path) => path.startsWith("resource:"))
    .map((path) => `Resource ${path.slice(9)}`);
  const patterns = overlap.files
    .filter((path) => path.startsWith("pattern:"))
    .map((path) => `Pattern ${path.slice(8)}`);
  const files = overlap.files.filter(
    (path) =>
      !path.startsWith("task:") && !path.startsWith("resource:") && !path.startsWith("pattern:"),
  );
  return [
    ...(asked.length === 0 ? [] : [`A question about ${asked.join(", ")}`]),
    ...resources,
    ...patterns,
    ...(files.length === 0 ? [] : [files.join(", ")]),
  ].join(" · ");
}

export const peerAgentIsBlocked = (status: PeerWorkStatus): boolean => status === "blocked";
export const peerAgentIsGone = (
  agent: { readonly status?: PeerWorkStatus; readonly gone?: boolean } | null | undefined,
): boolean => agent == null || agent.gone === true;
