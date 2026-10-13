import type { PeerMobilePlugin } from "../slotTypes";
import { PeerPlansSection } from "./PeerPlansSection";
import { PlansBadge } from "./PlansBadge";
import { PlansSettingsRows } from "./PlansSettingsRows";

/**
 * Plans on the phone, read-only: the count under a task's row, the list under the selected task,
 * and how Plans stands on each computer in the Settings index.
 */
export const plansMobilePlugin: PeerMobilePlugin = {
  id: "plans",
  taskBadges: PlansBadge,
  taskSections: PeerPlansSection,
  settingsRows: PlansSettingsRows,
};
