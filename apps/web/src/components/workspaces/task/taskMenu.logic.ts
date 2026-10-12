/**
 * What a choice from a task's menu means on the task page. The menu is the one the task row shows
 * (`taskMenuItems` plus what plugins add); the page does the same things with the same choices.
 */
import type { TaskMenuEntry } from "../slots.types";
import { chosenArea } from "../workMenus.logic";

export type TaskMenuAction =
  /** A plugin's own item, or one in its submenu: it runs the choice itself. */
  | { readonly kind: "plugin"; readonly entry: TaskMenuEntry }
  /** The area to move the task to; null takes it out of its area. */
  | { readonly kind: "move-area"; readonly area: string | null }
  | { readonly kind: "new-chat" }
  | { readonly kind: "rename" }
  | { readonly kind: "reopen" }
  | { readonly kind: "toggle-done" }
  | { readonly kind: "remove" }
  | { readonly kind: "none" };

/**
 * What picking `choice` does. A plugin's entries are asked first, as the row does, so a plugin item
 * is never taken for a core one. A choice nothing here knows, and none picked, do nothing.
 */
export function taskMenuAction(
  choice: string | null,
  entries: ReadonlyArray<TaskMenuEntry>,
): TaskMenuAction {
  if (choice === null) return { kind: "none" };
  const entry = entries.find(
    (candidate) =>
      candidate.item.id === choice ||
      candidate.item.children?.some((child) => child.id === choice) === true,
  );
  if (entry !== undefined) return { kind: "plugin", entry };
  const moved = chosenArea(choice);
  if (moved !== undefined) return { kind: "move-area", area: moved.area };
  switch (choice) {
    case "new-thread":
      return { kind: "new-chat" };
    case "rename":
      return { kind: "rename" };
    case "reopen":
      return { kind: "reopen" };
    case "toggle-done":
      return { kind: "toggle-done" };
    case "remove":
      return { kind: "remove" };
    default:
      return { kind: "none" };
  }
}
