import type { PeerMobilePlugin } from "../slotTypes";
import { DependencyBadge, PeerTaskDependencies } from "./PeerTaskDependencies";
export const dependenciesMobilePlugin: PeerMobilePlugin = {
  id: "dependencies",
  taskBadges: DependencyBadge,
  taskSections: PeerTaskDependencies,
};
