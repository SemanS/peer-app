import type { PeerWebPlugin } from "../slots.types";
import { BlockedBy } from "./BlockedBy";
import { DependsOnSection } from "./DependsOnSection";
import { taskMenu } from "./taskMenu";
export const dependenciesWebPlugin: PeerWebPlugin = {
  id: "dependencies",
  taskBadges: BlockedBy,
  taskContext: DependsOnSection,
  taskMenu,
};
