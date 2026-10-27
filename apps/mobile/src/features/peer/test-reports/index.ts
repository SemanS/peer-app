import type { PeerMobilePlugin } from "../slotTypes";
import { ReportSection } from "./ReportSection";

/**
 * Test reports on the phone, read-only: the selected task's reports with their items and owners.
 * Filing, replacing and giving an item an owner happen on a computer.
 */
export const testReportsMobilePlugin: PeerMobilePlugin = {
  id: "test-reports",
  taskSections: ReportSection,
};
