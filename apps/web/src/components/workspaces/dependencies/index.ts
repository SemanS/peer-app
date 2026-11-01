import type { PeerWebPlugin } from "../slots.types";
import { BlockedBy } from "./BlockedBy";
import { taskMenu } from "./taskMenu";
export const dependenciesWebPlugin: PeerWebPlugin = {
  id: "dependencies",
  taskBadges: BlockedBy,
  taskMenu,
};
