import type { PeerWebPlugin } from "../slots.types";
import { RoleMark } from "./RoleMark";
import { StartReviewAction, startReviewMenu } from "./StartReview";
import { roleThreadMenu } from "./threadMenu";

/**
 * The roles plugin's web UI: Start a review on a task's row and in its menu, a thread's role on
 * its card ("reviewing", "reviewing · advisory"), and Set role: review / Clear role in the menu of
 * the person's own thread.
 */
export const rolesWebPlugin: PeerWebPlugin = {
  id: "roles",
  taskActions: StartReviewAction,
  taskMenu: startReviewMenu,
  threadMenu: roleThreadMenu,
  threadBadges: RoleMark,
};
