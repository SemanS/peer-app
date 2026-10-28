import type { PeerWebPlugin } from "../slots.types";
import { AcceptAction } from "./AcceptAction";
import { AcceptanceCard } from "./AcceptanceCard";
import { AcceptanceDialogs } from "./AcceptanceDialogs";
import { acceptanceMenu } from "./taskMenu";
import { AcceptedBadge } from "./AcceptedBadge";
import { teamTaskFacts } from "./acceptance.logic";

/**
 * Acceptance: a project's lead accepts a task's delivered work, as a fact on the task. A task's
 * page shows who accepted it and when with the history of acceptances and withdrawals, and offers
 * Accept… or Withdraw… to leads and admins (also in the task's menu, and Accept… on the row of a
 * task in review); the task's card gets an Accepted mark and the Team page "accepted by Ana", or
 * "done · not accepted". It stops no move.
 */
export const acceptanceWebPlugin: PeerWebPlugin = {
  id: "acceptance",
  background: AcceptanceDialogs,
  taskActions: AcceptAction,
  taskMenu: acceptanceMenu,
  taskBadges: AcceptedBadge,
  taskSections: AcceptanceCard,
  teamTaskFacts,
};
