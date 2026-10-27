import type { PeerWebPlugin } from "../slots.types";
import { ReviewSessions } from "./ReviewSessions";
import { RoleMark } from "./RoleMark";
import { teamSignals, teamTaskFacts } from "./roles.logic";
import { StartReviewAction, startReviewMenu } from "./StartReview";
import { roleThreadMenu } from "./threadMenu";

/**
 * The roles plugin's web UI: Start a review on a task's row and in its menu, a thread's role on
 * its card ("reviewing", "reviewing · advisory"), and Set role: review / Clear role in the menu of
 * the person's own thread. A task's page lists its review sessions; the Team page gives a task with
 * one a fact ("reviewing · Slavo") and signals a review session that changed files.
 */
export const rolesWebPlugin: PeerWebPlugin = {
  id: "roles",
  taskActions: StartReviewAction,
  taskMenu: startReviewMenu,
  threadMenu: roleThreadMenu,
  threadBadges: RoleMark,
  taskSections: ReviewSessions,
  teamTaskFacts,
  teamSignals,
};
