/**
 * The Chats view's rows in words. A row has two lines: the title with the chat's state, then
 * `‹task key› · ‹project› · ‹agent›` (`No task` when its project has tasks and the chat is on
 * none). This module decides what those lines say, which chats must add when they started to be
 * told apart, and the words of the status cell and the Finished shelf; the row components only
 * lay them out.
 */
import type { PeerHubStatus, PeerTask } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";

import { formatShortTimestamp, parseTimestampDate } from "../timestampFormat";
import type { SidebarV2TopStatusKind } from "./Sidebar.logic";
import { taskNamedIn } from "./workspaces/workTree.logic";

/** The task part of a row whose project has tasks but the chat is on none. */
export const NO_TASK_LABEL = "No task";

/**
 * What the status cell says, by the state `resolveSidebarV2TopStatus` finds. "New reply" is the
 * finished turn nobody has looked at yet; "Asks you" and "Needs approval" are the two things a
 * chat can wait on you for.
 */
export const CHAT_STATUS_LABEL: Readonly<Record<SidebarV2TopStatusKind, string>> = {
  approval: "Needs approval",
  done: "New reply",
  failed: "Failed",
  input: "Asks you",
  limited: "Limited",
  waiting: "Waiting",
  woke: "Woke",
  working: "Working",
};

// ── The second line ─────────────────────────────────────────────────────────

export type ChatMetaPartKind = "task" | "project" | "agent" | "started" | "when";

export interface ChatMetaPart {
  readonly kind: ChatMetaPartKind;
  readonly text: string;
}

function metaParts(
  candidates: ReadonlyArray<readonly [ChatMetaPartKind, string | null | undefined]>,
): ReadonlyArray<ChatMetaPart> {
  return candidates.flatMap(([kind, text]) => {
    const trimmed = text?.trim() ?? "";
    return trimmed === "" ? [] : [{ kind, text: trimmed }];
  });
}

/**
 * A chat's second line, in order: its task, its project, its agent, and, when another chat in the
 * list carries the same title, when it started. `task` is the key (or title) of the task it is
 * on, `No task`, or null where the project has no tasks to be on.
 */
export function chatMetaParts(input: {
  readonly task: string | null;
  readonly projectName: string | null;
  readonly agentName: string | null;
  /** Set only for chats sharing a title: the time it started, already formatted. */
  readonly startedAt: string | null;
}): ReadonlyArray<ChatMetaPart> {
  return metaParts([
    ["task", input.task],
    ["project", input.projectName],
    ["agent", input.agentName],
    ["started", input.startedAt === null ? null : `started ${input.startedAt}`],
  ]);
}

/**
 * An unsent draft's second line: its project, its task (lower case mid-line: `no task`) and when
 * it was started.
 */
export function draftMetaParts(input: {
  readonly projectName: string | null;
  readonly task: string | null;
  readonly createdLabel: string | null;
}): ReadonlyArray<ChatMetaPart> {
  return metaParts([
    ["project", input.projectName],
    ["task", input.task === NO_TASK_LABEL ? NO_TASK_LABEL.toLowerCase() : input.task],
    ["when", input.createdLabel],
  ]);
}

/** The line as one string, for the row's accessible name and tooltips. */
export function chatMetaText(parts: ReadonlyArray<ChatMetaPart>, separator = " · "): string {
  return parts.map((part) => part.text).join(separator);
}

/**
 * The project belongs on every row only while the list shows several: under one project (or a
 * list scoped to it) it repeats what the view's own line says.
 */
export function showProjectInChatMeta(projectNames: Iterable<string | null | undefined>): boolean {
  const names = new Set<string>();
  for (const name of projectNames) {
    if (name !== null && name !== undefined && name !== "") names.add(name);
    if (names.size > 1) return true;
  }
  return false;
}

// ── Chats that look alike ───────────────────────────────────────────────────

/** What makes two chats look alike in the list: their title, whatever its case or spacing. */
export function chatTitleKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The chats whose title another chat of the same list also carries. Their rows add when they
 * started, so "Receipt footer" from this morning and from an hour ago are not the same line.
 */
export function chatsSharingATitle(
  chats: ReadonlyArray<{ readonly key: string; readonly title: string }>,
): ReadonlySet<string> {
  const keysByTitle = new Map<string, string[]>();
  for (const chat of chats) {
    const title = chatTitleKey(chat.title);
    if (title === "") continue;
    const keys = keysByTitle.get(title);
    if (keys === undefined) keysByTitle.set(title, [chat.key]);
    else keys.push(chat.key);
  }
  const shared = new Set<string>();
  for (const keys of keysByTitle.values()) {
    if (keys.length > 1) for (const key of keys) shared.add(key);
  }
  return shared;
}

// ── Which task a chat is on ─────────────────────────────────────────────────

interface ChatTaskProject {
  readonly tasks: ReadonlyArray<PeerTask>;
  /** Whether any task has a key a branch or a title could name. */
  readonly keyed: boolean;
  /** This computer's threads (`peer:<thread id>`) → the task they were placed on. */
  readonly assignments: Readonly<Record<string, string>>;
}

/** The Hub's tasks as the sidebar needs them: by the local project a chat lives in. */
export interface ChatTaskIndex {
  readonly environmentId: string;
  /** The local (T3) project id → the workspace projects it is the checkout of. */
  readonly byLocalProject: ReadonlyMap<string, ReadonlyArray<ChatTaskProject>>;
  /** `<workspace>/<project>` → the same, for a draft that already names its task. */
  readonly byWorkspaceProject: ReadonlyMap<string, ChatTaskProject>;
}

/**
 * The Hub status as an index of tasks, or null while there is none. A chat is on the task it was
 * placed on, else the one task its branch or title names by key: the rule the Work tree uses.
 */
export function chatTaskIndex(
  status: Pick<PeerHubStatus, "environmentId" | "workspaces"> | null | undefined,
): ChatTaskIndex | null {
  if (status === null || status === undefined) return null;
  const byLocalProject = new Map<string, ChatTaskProject[]>();
  const byWorkspaceProject = new Map<string, ChatTaskProject>();
  for (const workspace of status.workspaces) {
    for (const state of workspace.projects) {
      const project: ChatTaskProject = {
        tasks: state.work.tasks,
        keyed: state.work.tasks.some((task) => task.key !== undefined && task.key !== ""),
        assignments: state.work.assignments,
      };
      byWorkspaceProject.set(`${workspace.slug}/${state.project.id}`, project);
      for (const repository of state.repositories) {
        if (repository.projectId === undefined) continue;
        const projects = byLocalProject.get(repository.projectId);
        if (projects === undefined) byLocalProject.set(repository.projectId, [project]);
        else if (!projects.includes(project)) projects.push(project);
      }
    }
  }
  return byLocalProject.size === 0 && byWorkspaceProject.size === 0
    ? null
    : { environmentId: status.environmentId, byLocalProject, byWorkspaceProject };
}

/** A task the way a row names it: its key, else its title. */
function taskName(task: Pick<PeerTask, "key" | "title">): string {
  return task.key !== undefined && task.key !== "" ? task.key : task.title;
}

export interface ChatTaskThread {
  readonly environmentId: string;
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly branch: string | null;
}

function taskOfThread(project: ChatTaskProject, thread: ChatTaskThread): PeerTask | undefined {
  const placed = project.assignments[`peer:${thread.id}`];
  const task = placed === undefined ? undefined : project.tasks.find((t) => t.id === placed);
  if (task !== undefined) return task;
  return project.keyed ? taskNamedIn(project.tasks, [thread.branch, thread.title]) : undefined;
}

/**
 * Names the task of each chat: its key, its title when it has no key, `No task`, or null for a
 * chat that is not in a workspace project (there are no tasks for it to be on) or lives on
 * another computer. The answers are remembered per chat while its project, branch and title
 * stay, because the sidebar asks again at every update of any chat.
 */
export function createChatTaskLabeler(
  index: ChatTaskIndex | null,
): (thread: ChatTaskThread) => string | null {
  if (index === null) return () => null;
  const remembered = new Map<
    string,
    { readonly signature: string; readonly label: string | null }
  >();
  return (thread) => {
    if (thread.environmentId !== index.environmentId) return null;
    const projects = index.byLocalProject.get(thread.projectId);
    if (projects === undefined) return null;
    const signature = `${thread.projectId}\u0000${thread.branch ?? ""}\u0000${thread.title}`;
    const key = `${thread.environmentId}:${thread.id}`;
    const known = remembered.get(key);
    if (known !== undefined && known.signature === signature) return known.label;
    let label: string = NO_TASK_LABEL;
    for (const project of projects) {
      const task = taskOfThread(project, thread);
      if (task !== undefined) {
        label = taskName(task);
        break;
      }
    }
    remembered.set(key, { signature, label });
    return label;
  };
}

/**
 * The task an unsent draft is for: the one it was started on, else the one its branch names;
 * `No task`, or null where its project is not part of a workspace.
 */
export function draftTaskLabel(
  index: ChatTaskIndex | null,
  draft: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly branch: string | null;
    readonly workTask?: {
      readonly workspace: string;
      readonly projectId: string;
      readonly taskId: string;
    } | null;
  },
): string | null {
  if (index === null || draft.environmentId !== index.environmentId) return null;
  const named =
    draft.workTask === null || draft.workTask === undefined
      ? undefined
      : index.byWorkspaceProject
          .get(`${draft.workTask.workspace}/${draft.workTask.projectId}`)
          ?.tasks.find((task) => task.id === draft.workTask?.taskId);
  if (named !== undefined) return taskName(named);
  const projects = index.byLocalProject.get(draft.projectId);
  if (projects === undefined) return null;
  for (const project of projects) {
    const task = project.keyed ? taskNamedIn(project.tasks, [draft.branch]) : undefined;
    if (task !== undefined) return taskName(task);
  }
  return NO_TASK_LABEL;
}

// ── The Finished shelf and snoozed rows ─────────────────────────────────────

/**
 * The line under the Finished shelf's header. It lists the ways a chat gets there that apply to
 * this computer's rules (`afterDays` is the quiet time before one finishes by itself, null when
 * that is off; `onMerge` whether a merged pull request finishes it), then what finishing does not
 * do and where archived chats are.
 */
export function finishedShelfNote(rules: {
  readonly afterDays: number | null;
  readonly onMerge: boolean;
}): string {
  const ways = ["you finished them"];
  if (rules.afterDays !== null) {
    ways.push(`they were quiet for ${rules.afterDays} ${rules.afterDays === 1 ? "day" : "days"}`);
  }
  if (rules.onMerge) ways.push("their PR merged");
  const last = ways.at(-1)!;
  const list =
    ways.length === 1
      ? last
      : ways.length === 2
        ? `${ways[0]} or ${last}`
        : `${ways.slice(0, -1).join(", ")}, or ${last}`;
  return `Chats with nothing left to do: ${list}. Finishing a chat never finishes its task. Archived chats are in Settings › Archived chats.`;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * When a snoozed chat comes back, as its row says it: `until 3:00 PM` today, `until tomorrow`,
 * `until Mon` within the week, `until Oct 20` later; empty for a time that cannot be read.
 */
export function snoozedUntilLabel(
  snoozedUntil: string,
  now: Date,
  timestampFormat: TimestampFormat,
): string {
  const wake = parseTimestampDate(snoozedUntil);
  if (wake === null) return "";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayDelta = Math.floor((wake.getTime() - startOfToday.getTime()) / DAY_MS);
  if (dayDelta <= 0) return `until ${formatShortTimestamp(snoozedUntil, timestampFormat)}`;
  if (dayDelta === 1) return "until tomorrow";
  if (dayDelta < 7) return `until ${wake.toLocaleDateString(undefined, { weekday: "short" })}`;
  return `until ${wake.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
