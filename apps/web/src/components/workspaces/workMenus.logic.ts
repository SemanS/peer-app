import type { ContextMenuItem, PeerProject, PeerWorkspaceRole } from "@t3tools/contracts";

import type { WorkTaskNode } from "./workTree.logic";

/**
 * A task's menu: `move-area` opens the project's areas, each `area:<name>` (an area's name is
 * whatever the project calls it), and `no-area` takes the task out of its area. `add-under` and
 * `move-under` open the Under picker; `make-group` and `make-task` change what the item is.
 */
export type WorkTaskMenuId =
  | "new-thread"
  | "move-area"
  | "no-area"
  | `area:${string}`
  | "add-under"
  | "move-under"
  | "make-group"
  | "make-task"
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
  /** A new chat needs the project's checkout on this computer. */
  readonly canStartThread: boolean;
  readonly inReview?: boolean;
  /** The project's areas in its order. */
  readonly areas?: ReadonlyArray<string>;
  /** The area the task is in now; undefined when it is in none. */
  readonly area?: string | undefined;
  /** The project's Hub keeps a task tree (`servesTree`): items go under one another. */
  readonly tree?: boolean;
}): ReadonlyArray<ContextMenuItem<WorkTaskMenuId>> {
  const areas = input.areas ?? [];
  const group = input.task.kind === "group";
  return [
    {
      id: "new-thread",
      label: "New chat on this task",
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
    ...(input.tree === true
      ? [
          {
            id: "add-under" as const,
            label: "Add an item under…",
            icon: "list-plus",
            separatorBefore: areas.length === 0,
          },
          { id: "move-under" as const, label: "Move under…", icon: "folder-tree" },
          group
            ? { id: "make-task" as const, label: "Make a task", icon: "check" }
            : { id: "make-group" as const, label: "Make a group", icon: "folder" },
        ]
      : []),
    {
      id: "rename",
      label: "Rename task",
      icon: "pencil",
      separatorBefore: areas.length === 0 || input.tree === true,
    },
    {
      id: "toggle-done",
      label: input.task.done ? "Reopen task" : "Set status to done",
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
