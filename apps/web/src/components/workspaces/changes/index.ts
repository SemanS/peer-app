import type { PeerWebPlugin } from "../slots.types";
import { TaskChanges } from "./TaskChanges";

/** Changes: a task's Jujutsu stack, which its room lists beside the conversation. */
export const changesWebPlugin: PeerWebPlugin = {
  id: "changes",
  taskSections: TaskChanges,
};
