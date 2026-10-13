import type { PeerWebPlugin } from "../slots.types";
import { PlansBadge } from "./PlansBadge";
import { PlansSection } from "./PlansSection";
import { PlansSettings } from "./PlansSettings";

/**
 * Plans: what agents said they will change, use and provide before editing, and where that meets
 * other work, read-only. The settings row is `alwaysSettings` rather than `settings` so it can say
 * what an inactive Plans means (a `settings` slot renders only while the plugin is active).
 */
export const plansWebPlugin: PeerWebPlugin = {
  id: "plans",
  taskContext: PlansSection,
  taskBadges: PlansBadge,
  alwaysSettings: PlansSettings,
};
