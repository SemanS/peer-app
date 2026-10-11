import type { ContextMenuItem, PeerProject, PeerTask, PeerWorkspaceRole } from "@t3tools/contracts";

import { taskLabel, type WorkTaskNode, type WorkThreadNode } from "./workTree.logic";

/**
 * What a thread's menu offers. Only your own work on this computer changes
 * from here: a colleague's thread, or yours on another computer, is read-only.
 * herdr owns its agents' names and lifetimes, so those only move between tasks.
 * Core's items are rename, move (`move`, `task:<id>`, `unassign`), archive and delete; plugins add
 * their own through `entries`.
 */
export function threadMenuItems(input: {
  readonly thread: WorkThreadNode;
  readonly tasks: ReadonlyArray<PeerTask>;
  /** The task the thread sits under now, null when on none. */
  readonly taskId: string | null;
  /** Archive refuses a thread whose agent is still attached. */
  readonly running: boolean;
  /** What active plugins add: `start` ahead of "Move to task", `end` after it. */
  readonly entries?: ReadonlyArray<{
    readonly item: ContextMenuItem<string>;
    readonly place: "start" | "end";
  }>;
}): ReadonlyArray<ContextMenuItem<string>> {
  const { thread, taskId } = input;
  if (!thread.mine || !thread.placeable) return [];
  const local = thread.open?.kind === "thread";
  const choices = input.tasks.filter((task) => task.status === "open" || task.id === taskId);
  const plugged = (place: "start" | "end") =>
    (input.entries ?? []).filter((entry) => entry.place === place).map((entry) => entry.item);
  return [
    ...(local ? [{ id: "rename" as const, label: "Rename thread", icon: "pencil" }] : []),
    ...plugged("start"),
    ...(thread.placeable
      ? [
          {
            id: "move" as const,
            label: "Move to task",
            icon: "folder-tree",
            children: [
              ...choices.map((task) => ({
                id: `task:${task.id}` as const,
                label: taskLabel(task),
                checked: task.id === taskId,
              })),
              {
                id: "unassign" as const,
                label: "Not on a task",
                checked: taskId === null,
                separatorBefore: choices.length > 0,
              },
            ],
          },
        ]
      : []),
    ...plugged("end"),
    ...(local
      ? [
          {
            id: "archive" as const,
            label: "Archive thread",
            icon: "archive",
            disabled: input.running,
            separatorBefore: true,
          },
          { id: "delete" as const, label: "Delete", icon: "trash", destructive: true },
        ]
      : []),
  ];
}

/**
 * A task's menu: `move-area` opens the project's areas, each `area:<name>` (an area's name is
 * whatever the project calls it), and `no-area` takes the task out of its area.
 */
export type WorkTaskMenuId =
  | "new-thread"
  | "move-area"
  | "no-area"
  | `area:${string}`
  | "rename"
  | "toggle-done"
  | "reopen"
  | "remove";

/**
 * What choosing an item of a task's "Move to area" submenu means: the area the task goes to, or
 * null for none. Undefined for any other choice.
 */
export function chosenArea(choice: string): { readonly area: string | null } | undefined {
  if (choice === "no-area") return { area: null };
  return choice.startsWith("area:") ? { area: choice.slice("area:".length) } : undefined;
}

/**
 * What a task's menu offers. Anyone on the project renames, moves or closes a task. With the
 * project's areas, a task moves between them from its menu, the area it is in marked, and out of
 * them again; a project with no areas has nowhere to move a task to.
 */
export function taskMenuItems(input: {
  readonly task: WorkTaskNode;
  /** A new thread needs the project's checkout on this computer. */
  readonly canStartThread: boolean;
  readonly inReview?: boolean;
  /** The project's areas in its order. */
  readonly areas?: ReadonlyArray<string>;
  /** The area the task is in now; undefined when it is in none. */
  readonly area?: string | undefined;
}): ReadonlyArray<ContextMenuItem<WorkTaskMenuId>> {
  const areas = input.areas ?? [];
  return [
    {
      id: "new-thread",
      label: "New thread on this task",
      icon: "message-square-plus",
      disabled: !input.canStartThread,
    },
    ...(areas.length === 0
      ? []
      : [
          {
            id: "move-area" as const,
            label: "Move to area",
            icon: "folder-tree",
            separatorBefore: true,
            children: [
              ...areas.map((name) => ({
                id: `area:${name}` as const,
                label: name,
                checked: name === input.area,
              })),
              {
                id: "no-area" as const,
                label: "No area",
                checked: input.area === undefined,
                separatorBefore: true,
              },
            ],
          },
        ]),
    {
      id: "rename",
      label: "Rename task",
      icon: "pencil",
      separatorBefore: areas.length === 0,
    },
    {
      id: "toggle-done",
      label: input.task.done ? "Reopen task" : "Mark done",
      icon: "circle-check",
    },
    ...(input.inReview
      ? [{ id: "reopen" as const, label: "Reopen task", icon: "circle-check" }]
      : []),
    ...(input.task.removable
      ? [
          {
            id: "remove" as const,
            label: "Remove task",
            icon: "trash",
            destructive: true,
            separatorBefore: true,
          },
        ]
      : []),
  ];
}

export type WorkProjectMenuId = "remove-project";

/**
 * Whether this person may take a shared project out of the workspace: whoever shared it from Peer,
 * or the workspace's owner or admins. A project from the workspace's configuration is not shared
 * from Peer; it leaves only through that configuration.
 */
export function canRemoveProject(input: {
  readonly project: Pick<PeerProject, "addedBy">;
  readonly workspaceRole: PeerWorkspaceRole;
  readonly email: string | null;
}): boolean {
  if (input.project.addedBy === undefined) return false;
  return input.project.addedBy === input.email || input.workspaceRole !== "member";
}

/** What a project's menu offers. */
export function projectMenuItems(input: {
  readonly removable: boolean;
}): ReadonlyArray<ContextMenuItem<WorkProjectMenuId>> {
  return input.removable
    ? [{ id: "remove-project", label: "Remove from workspace", icon: "trash", destructive: true }]
    : [];
}
