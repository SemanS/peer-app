/**
 * What a task's page says, worked out from the Work tree and the Hub's status: the task's state in
 * words, what waits on the person, its chats (theirs to open, a colleague's only to ask about), the
 * task context and the details that stay folded. Pure, so web and tests read the same answer.
 */
import { summaryOf } from "@t3tools/client-runtime/peer/handoff";
import {
  openKey,
  taskOwnership,
  taskState,
  type AgentNeed,
  type TaskState,
  type TaskStateKind,
} from "@t3tools/client-runtime/peer/work";
import type { PeerHubStatus } from "@t3tools/contracts";

import type { SignalTone } from "../signals";
import {
  personName,
  type WorkAreaNode,
  type WorkOpen,
  type WorkProjectNode,
  type WorkTaskNode,
  type WorkThreadNode,
} from "../workTree.logic";
import { chatRows, UNKNOWN_AGENT, type TaskChatRow } from "./taskChats.logic";
import {
  contextCard,
  contextMovedOn,
  detailRows,
  handoffAuthor,
  newestHandoff,
  type HandoffSummary,
  type TaskContextCard,
  type TaskDetail,
} from "./taskDetails.logic";
import { agoLabel, clockLabel, dateLabel } from "./taskTime.logic";

export interface TaskPageIds {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}

/** The task a page names, with the project and the area it is in; undefined once it is gone. */
export function findTask(
  tree: ReadonlyArray<WorkProjectNode>,
  ids: TaskPageIds,
):
  | {
      readonly project: WorkProjectNode;
      readonly area: WorkAreaNode;
      readonly task: WorkTaskNode;
    }
  | undefined {
  const project = tree.find((p) => p.workspace === ids.workspace && p.projectId === ids.project);
  for (const area of project?.areas ?? []) {
    const task = area.tasks.find((candidate) => candidate.id === ids.task);
    if (project !== undefined && task !== undefined) return { project, area, task };
  }
  return undefined;
}

/** The colour and mark of a task's state: hollow for a state that waits on someone else. */
export function taskStateLook(kind: TaskStateKind): {
  readonly tone: SignalTone;
  readonly hollow: boolean;
} {
  switch (kind) {
    case "done":
      return { tone: "delivery", hollow: false };
    case "review":
    case "approval":
    case "input":
      return { tone: "needs", hollow: false };
    case "working":
      return { tone: "working", hollow: false };
    case "waiting":
      return { tone: "working", hollow: true };
    case "paused":
      return { tone: "neutral", hollow: false };
    case "new":
      return { tone: "neutral", hollow: true };
  }
}

export interface TaskPerson {
  readonly name: string;
  readonly mine: boolean;
}

/** What the primary button of the page does. */
export type TaskPrimary =
  | { readonly kind: "review"; readonly label: string }
  | { readonly kind: "chat"; readonly label: string; readonly open: WorkOpen }
  | { readonly kind: "start"; readonly label: "Start a chat" };

/** Something that waits on the person: the review, or a chat of theirs that asks or needs approval. */
export type TaskWait =
  | {
      readonly kind: "review";
      readonly key: string;
      readonly title: string;
      readonly detail: string;
    }
  | {
      readonly kind: "approval" | "input";
      /** The chat it is about, so a list of waits keeps one row per chat. */
      readonly key: string;
      readonly title: string;
      readonly detail: string;
      /** Where the chat opens; undefined for one on another computer that cannot be opened here. */
      readonly open: WorkOpen | undefined;
      /** What a herdr agent asks in its terminal, when Peer could read it; a Peer thread's question is read from the thread. */
      readonly question?: string;
    };

export interface TaskPageModel {
  readonly key: string | undefined;
  readonly title: string;
  readonly state: TaskState;
  readonly tone: SignalTone;
  readonly hollow: boolean;
  /** The area it is in; null for a task in none. */
  readonly area: string | null;
  readonly people: ReadonlyArray<TaskPerson>;
  /** "You and Ana · created by you on 10 Oct". */
  readonly meta: string;
  readonly primary: TaskPrimary;
  /** Whether "Start a chat" also shows beside a primary action that is something else. */
  readonly offerStart: boolean;
  readonly waits: ReadonlyArray<TaskWait>;
  /** Everyone's chats on the task, the person's own first. */
  readonly chats: ReadonlyArray<TaskChatRow>;
  readonly context: TaskContextCard | undefined;
  readonly details: ReadonlyArray<TaskDetail>;
  /** Who created the task ("You", "Ana") and when: the last line of its activity. */
  readonly created: { readonly by: string; readonly at: string } | undefined;
}

/** The people on a task: those whose chats are on it, the person first, then its creator. */
function peopleOn(
  task: WorkTaskNode,
  creator: TaskPerson | undefined,
): { readonly onChats: ReadonlyArray<TaskPerson>; readonly all: ReadonlyArray<TaskPerson> } {
  const onChats = [
    ...new Map(
      task.threads.map(
        (thread) =>
          [`${thread.mine}:${thread.person}`, { name: thread.person, mine: thread.mine }] as const,
      ),
    ).values(),
  ].toSorted((a, b) => Number(b.mine) - Number(a.mine));
  const listed =
    creator === undefined ||
    onChats.some((person) => person.mine === creator.mine && person.name === creator.name);
  return { onChats, all: listed ? onChats : [...onChats, creator] };
}

function listNames(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** "You and Ana · created by you on 10 Oct"; only "Created by you on 10 Oct" while no chat is on it. */
export function taskMeta(input: {
  readonly onChats: ReadonlyArray<TaskPerson>;
  readonly creator: TaskPerson | undefined;
  readonly createdAt: string | undefined;
  readonly now: number;
}): string {
  const names = listNames(input.onChats.map((person) => (person.mine ? "You" : person.name)));
  if (input.creator === undefined && input.createdAt === undefined) return names;
  const by =
    input.creator === undefined ? "" : ` by ${input.creator.mine ? "you" : input.creator.name}`;
  const on = input.createdAt === undefined ? "" : ` on ${dateLabel(input.createdAt, input.now)}`;
  const created = `created${by}${on}`;
  return names === ""
    ? `${created.charAt(0).toUpperCase()}${created.slice(1)}`
    : `${names} · ${created}`;
}

/**
 * What waits on the person: the review first, when it asks them, then their chats that ask or need
 * approval. A review that asks someone else is not a wait of theirs; the page's state says whose it is.
 */
function waitsOn(input: {
  readonly task: WorkTaskNode;
  readonly state: TaskState;
  readonly chats: ReadonlyArray<TaskChatRow>;
  readonly needs: ReadonlyMap<string, AgentNeed>;
  readonly handoff: HandoffSummary | undefined;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly now: number;
}): ReadonlyArray<TaskWait> {
  const { task, state, chats, needs, handoff, status, now } = input;
  if (state.kind === "done") return [];
  const waits: TaskWait[] = [];
  if (state.kind === "review") {
    const moved = contextMovedOn(task.context, handoff);
    waits.push({
      kind: "review",
      key: "review",
      title:
        handoff === undefined
          ? "This task waits for your review"
          : `${handoffAuthor(handoff, status, input.workspace)} handed this task off ${agoLabel(handoff.composedAt, now)}`,
      detail: `Review it to mark the task done, or reopen it with a note for the agent.${
        moved === null
          ? ""
          : ` The task context changed after the handoff (v${moved.read} → v${moved.latest}).`
      }`,
    });
  }
  const asking = task.threads
    .filter((thread) => thread.mine && !thread.stale && thread.status === "blocked")
    .map((thread) => ({
      thread,
      approval: thread.open !== undefined && needs.get(openKey(thread.open)) === "approval",
    }))
    .toSorted((a, b) => Number(b.approval) - Number(a.approval));
  for (const { thread, approval } of asking) {
    const row = chats.find((candidate) => candidate.key === thread.key);
    if (row === undefined) continue;
    // "Claude", or "Your agent" while nothing names the agent.
    const who = row.agent === UNKNOWN_AGENT ? "Your agent" : row.agent;
    const open = row.open;
    const question =
      open?.kind === "herdr"
        ? status.agents.list.find((agent) => agent.id === open.agentId)?.asks
        : undefined;
    waits.push(
      approval
        ? {
            kind: "approval",
            key: `approval:${row.key}`,
            title: `${who} needs your approval`,
            detail: `In “${row.title}”. Open the chat to approve or deny.`,
            open: row.open,
          }
        : {
            kind: "input",
            key: `input:${row.key}`,
            title: `${who} has a question for you`,
            detail: `In “${row.title}”. ${question === undefined ? "Open the chat to answer." : "Answer it in its terminal, or open the chat."}`,
            open: row.open,
            ...(question === undefined ? {} : { question }),
          },
    );
  }
  return waits;
}

/**
 * What the primary button does by the task's state: the review for a task in review, the chat that
 * waits for an approval or an answer, then an existing chat of theirs before starting another.
 */
function primaryOf(
  state: TaskState,
  handoff: HandoffSummary | undefined,
  waits: ReadonlyArray<TaskWait>,
  chats: ReadonlyArray<TaskChatRow>,
): TaskPrimary {
  if (state.kind === "review") {
    return {
      kind: "review",
      label: handoff === undefined ? "Review" : `Review handoff #${handoff.number}`,
    };
  }
  if (state.kind === "approval" || state.kind === "input") {
    // The first chat of that kind that can be opened here.
    const open = waits.flatMap((wait) =>
      wait.kind === state.kind && wait.kind !== "review" && wait.open !== undefined
        ? [wait.open]
        : [],
    )[0];
    if (open !== undefined) {
      return {
        kind: "chat",
        label: state.kind === "approval" ? "Approve in chat" : "Answer in chat",
        open,
      };
    }
  }
  const existing = chats.find((chat) => chat.mine && chat.open !== undefined);
  if (existing?.open !== undefined) {
    return {
      kind: "chat",
      label: existing.open.kind === "observe" ? "Watch chat" : "Open chat",
      open: existing.open,
    };
  }
  return { kind: "start", label: "Start a chat" };
}

/**
 * Everything the task page shows of one task, or null when the tree has no such task. `needs` is
 * what Needs you says each of the person's waiting chats waits for (`needsByOpen`); `agentName`
 * names a chat's agent where the client knows more than its harness (this computer's provider
 * instances); `clock` writes a time of day in the person's own format.
 */
export function taskPageModel(input: {
  readonly tree: ReadonlyArray<WorkProjectNode>;
  readonly ids: TaskPageIds;
  readonly needs: ReadonlyMap<string, AgentNeed>;
  readonly status: PeerHubStatus;
  readonly now: number;
  readonly agentName?: (thread: WorkThreadNode) => string | undefined;
  readonly clock?: (at: string) => string;
}): TaskPageModel | null {
  const { tree, ids, needs, status, now } = input;
  const found = findTask(tree, ids);
  if (found === undefined) return null;
  const { project, area, task } = found;

  const state = status.workspaces
    .find((w) => w.slug === ids.workspace)
    ?.projects.find((p) => p.project.id === ids.project);
  const hub = project.tasks.find((t) => t.id === ids.task);
  const nameOf = (email: string) => (state === undefined ? email : personName(state, email));
  const me = status.email;
  const creator: TaskPerson | undefined =
    hub === undefined ? undefined : { name: nameOf(hub.createdBy), mine: hub.createdBy === me };
  // A review asks the task's owner, else the project's leads, else every member.
  const taskStatus = taskState(task, needs, taskOwnership(project, task, area.name).review);
  const look = taskStateLook(taskStatus.kind);
  const people = peopleOn(task, creator);

  const chats = chatRows(task.threads, { state, status, needs, now, agentName: input.agentName });
  const summaries = summaryOf(status.handoff, {
    workspace: ids.workspace,
    projectId: ids.project,
    taskId: ids.task,
  });
  const handoff = newestHandoff(summaries);
  const waits = waitsOn({
    task,
    state: taskStatus,
    chats,
    needs,
    handoff,
    status,
    workspace: ids.workspace,
    now,
  });
  const primary = primaryOf(taskStatus, handoff, waits, chats);

  return {
    key: task.key,
    title: task.title,
    state: taskStatus,
    tone: look.tone,
    hollow: look.hollow,
    area: area.name,
    people: people.all,
    meta: taskMeta({ onChats: people.onChats, creator, createdAt: hub?.createdAt, now }),
    primary,
    offerStart: primary.kind !== "start",
    waits,
    chats,
    context: contextCard({
      context: task.context,
      handoff,
      me: me === null ? undefined : nameOf(me),
      keeperAgent: chats
        .filter((row) => row.mine && row.agent !== UNKNOWN_AGENT)
        .find((row) => task.threads.some((thread) => thread.key === row.key && thread.keepsContext))
        ?.agent,
      now,
    }),
    created:
      hub === undefined || creator === undefined
        ? undefined
        : { by: creator.mine ? "You" : creator.name, at: hub.createdAt },
    details: detailRows({
      task,
      summaries,
      handoff,
      created: hub === undefined ? undefined : { by: nameOf(hub.createdBy), at: hub.createdAt },
      state,
      status,
      workspace: ids.workspace,
      now,
      clock: input.clock ?? clockLabel,
    }),
  };
}
