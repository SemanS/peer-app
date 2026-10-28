import type { PeerWebPlugin } from "../slots.types";
import { ReportSection } from "./ReportSection";
import { TaskBadge } from "./TaskBadge";
import { teamSignals, teamTaskFacts } from "./testReports.logic";

/**
 * Test reports: what a task's work was checked against, kept by the Hub per task and author. A
 * task's page lists every report with its items and their owners, where people file their own and
 * the task's owner, a lead or an admin gives an unverified item an owner; the task's row shows the
 * newest result; the Team page gets a fact per task and a signal for each task whose newest report
 * has items nobody answers for.
 */
export const testReportsWebPlugin: PeerWebPlugin = {
  id: "test-reports",
  taskSections: ReportSection,
  taskBadges: TaskBadge,
  teamTaskFacts,
  teamSignals,
};
